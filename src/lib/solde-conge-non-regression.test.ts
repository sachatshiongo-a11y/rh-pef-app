import { describe, it, expect } from "vitest";
import { ancienneteEnMois } from "./payroll";
import { bilansParAnnee, calculerSoldeAnneeCivile, repartirCongeParJour } from "./solde-conge-salarie";
import { periodesSansConges } from "./conges-periodes";
import { ancienneteALaSortie } from "./sortie-salarie";

// NON-RÉGRESSION (relecture du 2026-10-12, décisions Direction « date de sortie » et « sans congés par période »).
// Un salarié en poste, sans stage ni intérim dans son historique, doit garder EXACTEMENT le solde d'avant : on compare
// le calcul actuel à une copie FIGÉE de l'algorithme de main (commit 1f799927), sur des milliers de cas tirés au sort.
// Si ce test rougit, un chiffre a changé pour quelqu'un que la décision ne visait pas.

const auDixieme = (x: number) => Math.round(x * 10) / 10;
function ancienCalcul(p: { dateEmbauche: Date; aujourdhui: Date; droitsAnnuels: number; sansConges: boolean; prisParJour: { date: Date; jours: number }[]; cSansDemande?: Date[] }) {
  const annee = p.aujourdhui.getUTCFullYear();
  const embauche = new Date(p.dateEmbauche);
  const parMois = p.droitsAnnuels / 12;
  const auCent = (x: number) => Math.round(x * 100) / 100;
  const debutAnnee = Date.UTC(annee, 0, 1);
  const finAnnee = Date.UTC(annee, 11, 31);
  const auj = p.aujourdhui.getTime();
  const pris = new Map<number, number>();
  const ajouter = (t: number, j: number) => { if (t <= finAnnee) pris.set(t, (pris.get(t) ?? 0) + j); };
  for (const x of p.prisParJour) ajouter(new Date(x.date).getTime(), x.jours);
  const cSans = (p.cSansDemande ?? []).filter((d) => new Date(d).getTime() <= finAnnee);
  for (const d of cSans) ajouter(new Date(d).getTime(), 1);
  const premier = Math.min(Date.UTC(embauche.getUTCFullYear(), embauche.getUTCMonth(), embauche.getUTCDate()), ...pris.keys(), debutAnnee);
  let solde = 0, mois = 0, report = 0, acquisAnnee = 0, perdu = 0, prisAnnee = 0;
  for (let t = premier; t <= finAnnee; t += 86_400_000) {
    if (t === debutAnnee) report = auCent(solde);
    if (!p.sansConges && t <= auj) {
      const m = ancienneteEnMois(embauche, new Date(t));
      if (m > mois) {
        const gagne = (m - mois) * parMois;
        mois = m;
        const apres = Math.min(p.droitsAnnuels, solde + gagne);
        if (t >= debutAnnee) { acquisAnnee += gagne; perdu += solde + gagne - apres; }
        solde = auCent(apres);
      }
    }
    const j = pris.get(t);
    if (j) { solde = auCent(solde - j); if (t >= debutAnnee) prisAnnee += j; }
  }
  const prisR = auDixieme(prisAnnee);
  const soldeR = auDixieme(solde);
  return { annee, acquis: auDixieme(soldeR + prisR), acquisAnnee: auDixieme(acquisAnnee), report: auDixieme(report), plafonne: perdu > 0.001, perdu: auDixieme(perdu), pris: prisR, cSansDemande: cSans.filter((d) => new Date(d).getTime() >= debutAnnee).length, solde: soldeR };
}

// Générateur déterministe (le même tirage à chaque passage : un échec se rejoue).
function lcg(graine: number) { let s = graine >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
const JOUR = 86_400_000;
const jour = (t: number) => new Date(Math.floor(t / JOUR) * JOUR);

function cas(rnd: () => number) {
  const embauche = jour(Date.UTC(2015, 0, 1) + Math.floor(rnd() * 11.5 * 365) * JOUR);
  const aujourdhui = jour(embauche.getTime() + Math.floor(rnd() * 6 * 365) * JOUR);
  const prisParJour: { date: Date; jours: number }[] = [];
  const nb = Math.floor(rnd() * 6);
  for (let k = 0; k < nb; k++) {
    const debut = embauche.getTime() + Math.floor((rnd() * 1.2 - 0.05) * (aujourdhui.getTime() - embauche.getTime() + 400 * JOUR));
    const duree = 1 + Math.floor(rnd() * 15);
    prisParJour.push(...repartirCongeParJour({ dateDebut: jour(debut), dateFin: jour(debut + (duree - 1) * JOUR), nbJours: Math.round(rnd() * duree * 2) / 2 }, new Set()));
  }
  const cSansDemande = Array.from({ length: Math.floor(rnd() * 3) }, () => jour(embauche.getTime() + Math.floor(rnd() * (aujourdhui.getTime() - embauche.getTime() + JOUR))));
  // Historique de contrats SANS stage ni intérim : CDD renouvelés, CDI, journalier, avec ou sans trou.
  const types = ["CDD", "CDI", "JOURNALIER"];
  const contrats: { type: string; dateDebut: Date; dateFin: Date | null }[] = [];
  let debut = embauche.getTime() + (rnd() < 0.3 ? Math.floor(rnd() * 200) * JOUR : 0);
  for (let k = 0, n = Math.floor(rnd() * 4); k < n; k++) {
    const fin = rnd() < 0.5 ? debut + Math.floor(30 + rnd() * 400) * JOUR : null;
    contrats.push({ type: types[Math.floor(rnd() * 3)], dateDebut: jour(debut), dateFin: fin === null ? null : jour(fin) });
    debut = (fin ?? debut + Math.floor(30 + rnd() * 400) * JOUR) + (rnd() < 0.3 ? Math.floor(rnd() * 90) * JOUR : JOUR);
  }
  return { dateEmbauche: embauche, aujourdhui, droitsAnnuels: 18, prisParJour, cSansDemande, contrats };
}

describe("non-régression : un salarié en poste sans stage ni intérim garde STRICTEMENT le solde d'avant", () => {
  it("3 000 cas tirés au sort (embauche, congés, C sans demande, CDD renouvelés, trous) : même résultat champ par champ", () => {
    const rnd = lcg(20261012);
    for (let i = 0; i < 3000; i++) {
      const e = cas(rnd);
      const avant = ancienCalcul({ ...e, sansConges: false });
      const apres = calculerSoldeAnneeCivile({ ...e, periodesSansConges: periodesSansConges(e.contrats, "CDI"), dateSortie: null });
      expect(apres, `cas ${i} : ${JSON.stringify(e)}`).toEqual(avant);
    }
  });

  it("les bilans année par année aussi (chaque année = l'ancien calcul au 31 décembre, l'année en cours à date)", () => {
    const rnd = lcg(7);
    for (let i = 0; i < 300; i++) {
      const e = cas(rnd);
      const nouveaux = bilansParAnnee({ ...e, periodesSansConges: periodesSansConges(e.contrats, "CDD"), dateSortie: null });
      for (const b of nouveaux) {
        const { enCours, ...r } = b;
        const ref = ancienCalcul({ ...e, sansConges: false, aujourdhui: enCours ? e.aujourdhui : new Date(Date.UTC(b.annee, 11, 31)) });
        expect(r, `cas ${i}, ${b.annee}`).toEqual(ref);
      }
    }
  });

  it("une fiche STAGE sans historique de contrat reste sans congés, exactement comme avant", () => {
    const rnd = lcg(42);
    for (let i = 0; i < 500; i++) {
      const e = cas(rnd);
      expect(calculerSoldeAnneeCivile({ ...e, periodesSansConges: periodesSansConges([], "STAGE") }), `cas ${i}`).toEqual(ancienCalcul({ ...e, sansConges: true }));
    }
  });
});

const j = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("congé posé APRÈS la date de sortie : jamais déduit de l'indemnité de congés non pris, toujours signalé", () => {
  // CDI embauché le 01/01/2025, parti le 30/06/2026 : 18 j au compteur (plafond). Un congé de 10 j avait été
  // approuvé pour le 13 → 24/07/2026. Avant la correction : solde de sortie 8 j (10 j × salaire journalier perdus).
  const pris = repartirCongeParJour({ dateDebut: j("2026-07-13"), dateFin: j("2026-07-24"), nbJours: 10 }, new Set());
  it("le solde à la sortie reste 18 j ; les 10 j sont rendus à part", () => {
    const r = calculerSoldeAnneeCivile({ dateEmbauche: j("2025-01-01"), aujourdhui: j("2026-10-12"), droitsAnnuels: 18, prisParJour: pris, dateSortie: j("2026-06-30") });
    expect(r).toMatchObject({ annee: 2026, solde: 18, pris: 0, prisApresSortie: 10 });
  });
  it("un « C » de la grille après la sortie : idem (non déduit, signalé)", () => {
    const r = calculerSoldeAnneeCivile({ dateEmbauche: j("2025-01-01"), aujourdhui: j("2026-10-12"), droitsAnnuels: 18, prisParJour: [], cSansDemande: [j("2026-07-01")], dateSortie: j("2026-06-30") });
    expect(r).toMatchObject({ solde: 18, pris: 0, cSansDemande: 0, prisApresSortie: 1 });
  });
  it("le congé pris le jour même de la sortie se déduit (dernier jour de présence inclus)", () => {
    const r = calculerSoldeAnneeCivile({ dateEmbauche: j("2025-01-01"), aujourdhui: j("2026-10-12"), droitsAnnuels: 18, prisParJour: [{ date: j("2026-06-30"), jours: 1 }], dateSortie: j("2026-06-30") });
    expect(r).toMatchObject({ solde: 17, pris: 1 });
    expect(r.prisApresSortie).toBeUndefined();
  });
  it("sans sortie, rien ne change (aucun champ en plus)", () => {
    const r = calculerSoldeAnneeCivile({ dateEmbauche: j("2025-01-01"), aujourdhui: j("2026-06-01"), droitsAnnuels: 18, prisParJour: pris });
    expect(r.prisApresSortie).toBeUndefined();
    expect(r.pris).toBe(10);
  });
});

describe("ancienneté de l'indemnité de licenciement : à la date de sortie, même convention que les congés", () => {
  it("le mois qui s'achève le jour de la sortie est révolu ; la veille, non", () => {
    expect(ancienneteALaSortie(j("2020-03-15"), j("2026-10-14"))).toBe(79); // 15/03/2020 → 14/10/2026 inclus : 79 mois
    expect(ancienneteALaSortie(j("2020-03-15"), j("2026-10-13"))).toBe(78);
    expect(ancienneteALaSortie(j("2025-03-01"), j("2025-09-30"))).toBe(7); // comme le test des congés : 7 mois → 10,5 j
  });
  it("ne dépend ni d'aujourd'hui ni du mois de paie : un départ enregistré après coup garde son ancienneté", () => {
    expect(ancienneteALaSortie(j("2024-01-01"), j("2025-06-30"))).toBe(18);
  });
});
