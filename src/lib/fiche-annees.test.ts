import { describe, it, expect } from "vitest";
import {
  anneesAvecDonnees, anneesDeConges, lienFicheAnnee, lireAnneeFiche, redirectionAncienOnglet, totauxAnnuelsPaie, type LigneTotauxPaie,
} from "./fiche-annees";
import { bilansParAnnee, calculerSoldeAnneeCivile, repartirCongeParJour } from "./solde-conge-salarie";

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("lireAnneeFiche — ?annee= de la fiche", () => {
  const dispo = [2026, 2025, 2024];
  it("absent, illisible ou hors des années de la fiche : l'année en cours", () => {
    expect(lireAnneeFiche(undefined, dispo, 2026)).toBe(2026);
    expect(lireAnneeFiche("abc", dispo, 2026)).toBe(2026);
    expect(lireAnneeFiche("2019", dispo, 2026)).toBe(2026);
    expect(lireAnneeFiche("2025; DROP", dispo, 2026)).toBe(2026);
  });
  it("une année de la fiche est respectée (aussi quand elle arrive en tableau)", () => {
    expect(lireAnneeFiche("2025", dispo, 2026)).toBe(2025);
    expect(lireAnneeFiche(["2024", "2025"], dispo, 2026)).toBe(2024);
  });
  it("« toutes » n'existe que si l'écran le propose", () => {
    expect(lireAnneeFiche("toutes", dispo, 2026, true)).toBe("toutes");
    expect(lireAnneeFiche("toutes", dispo, 2026)).toBe(2026);
  });
});

describe("années proposées et adresses", () => {
  it("les années de données + l'année en cours, de la plus récente à la plus ancienne, sans doublon", () => {
    expect(anneesAvecDonnees([2024, 2025, 2025], 2026)).toEqual([2026, 2025, 2024]);
    expect(anneesAvecDonnees([], 2026)).toEqual([2026]);
  });
  it("congés : l'année d'une demande à cheval et celle d'une demande à venir comptent", () => {
    const annees = anneesDeConges([{ annee: 2025 }, { annee: 2026 }], [{ dateDebut: jour("2026-12-28"), dateFin: jour("2027-01-04") }], 2026);
    expect(annees).toEqual([2027, 2026, 2025]);
  });
  it("le lien d'une pastille garde l'onglet et porte l'année", () => {
    expect(lienFicheAnnee("e1", "paie", 2025)).toBe("/employes/e1?tab=paie&annee=2025");
    expect(lienFicheAnnee("e1", "paie", "toutes")).toBe("/employes/e1?tab=paie&annee=toutes");
  });
});

describe("l'ancien onglet « Fin de contrat »", () => {
  it("?tab=fin (et fin-contrat) mène à la section de l'onglet Contrats", () => {
    expect(redirectionAncienOnglet("fin")).toBe("tab=contrats#fin-de-contrat");
    expect(redirectionAncienOnglet("fin-contrat")).toBe("tab=contrats#fin-de-contrat");
  });
  it("les onglets qui existent ne sont pas redirigés", () => {
    for (const t of [undefined, "apercu", "temps", "conges", "paie", "contrats", "dossier"]) expect(redirectionAncienOnglet(t)).toBeNull();
  });
});

describe("totauxAnnuelsPaie — additionner dans la même devise, « — » si inconnu", () => {
  const ligne = (statutPaiement: LigneTotauxPaie["statutPaiement"], salNetUSD: number, transportUSD: number, taux: number): LigneTotauxPaie => ({ statutPaiement, salNetUSD, transportUSD, taux });
  it("net = total versé − transport ; le CDF est la somme des lignes, chacune à son taux", () => {
    const t = totauxAnnuelsPaie([ligne("PAYE", 300, 20, 2800), ligne("PAYE", 310, 20, 2900), ligne("VALIDE", 200, 10, 2900)]);
    expect(t).toMatchObject({ payes: 2, valides: 1, nonValides: 0, comptes: 3, netUSD: 760, verseUSD: 810 });
    expect(t.netCDF).toBe(280 * 2800 + 290 * 2900 + 190 * 2900);
  });
  it("un bulletin non validé est compté à part et jamais additionné", () => {
    const t = totauxAnnuelsPaie([ligne("PAYE", 300, 20, 2800), ligne("PAS_VALIDE", 999, 0, 2800)]);
    expect(t).toMatchObject({ payes: 1, nonValides: 1, comptes: 1, netUSD: 280, verseUSD: 300, netCDF: 280 * 2800 });
  });
  it("un taux inconnu sur un bulletin rend le total en francs inconnu — jamais complété, jamais 0", () => {
    const t = totauxAnnuelsPaie([ligne("PAYE", 300, 20, 2800), ligne("PAYE", 300, 20, 0)]);
    expect(t.netCDF).toBeNull();
    expect(t.netUSD).toBe(560); // les dollars n'ont pas besoin du taux
  });
  it("aucun bulletin validé ou payé : tout est inconnu (null), pas 0", () => {
    expect(totauxAnnuelsPaie([ligne("PAS_VALIDE", 100, 0, 2800)])).toEqual({ payes: 0, valides: 0, nonValides: 1, comptes: 0, netUSD: null, netCDF: null, verseUSD: null });
    expect(totauxAnnuelsPaie([])).toMatchObject({ netUSD: null, netCDF: null, verseUSD: null, comptes: 0 });
  });
  it("les centimes ne dérivent pas (flottants)", () => {
    const t = totauxAnnuelsPaie([ligne("PAYE", 0.1, 0, 2800), ligne("PAYE", 0.2, 0, 2800)]);
    expect(t.netUSD).toBe(0.3);
  });
});

// Le bilan de chaque année vient de `calculerSoldeAnneeCivile` — jamais d'un autre calcul.
describe("bilansParAnnee — report, acquis, pris, perdus, solde, année par année", () => {
  const feries = new Set(["2026-01-01"]);
  const prisParJour = [
    ...repartirCongeParJour({ dateDebut: jour("2025-11-03"), dateFin: jour("2025-11-14"), nbJours: 10 }, feries),
    // Congé à cheval : 29/12/2025 → 06/01/2026, 7 jours saisis, 1er janvier férié → 3 j en 2025, 4 j en 2026.
    ...repartirCongeParJour({ dateDebut: jour("2025-12-29"), dateFin: jour("2026-01-06"), nbJours: 7 }, feries),
    ...repartirCongeParJour({ dateDebut: jour("2026-08-03"), dateFin: jour("2026-08-06"), nbJours: 4 }, feries),
  ];
  const entrees = { dateEmbauche: jour("2025-03-20"), aujourdhui: jour("2026-10-12"), droitsAnnuels: 18, sansConges: false, prisParJour };
  const bilans = bilansParAnnee(entrees);

  it("une ligne par année, de l'embauche à l'année en cours ; seule la dernière est « à date »", () => {
    expect(bilans.map((b) => b.annee)).toEqual([2025, 2026]);
    expect(bilans.map((b) => b.enCours)).toEqual([false, true]);
  });

  it("2025 : embauché le 20/03, 9 mois révolus, 13 j pris dont 3 du congé à cheval → 0,5 j au 31 décembre", () => {
    expect(bilans[0]).toMatchObject({ report: 0, acquisAnnee: 13.5, pris: 13, perdu: 0, solde: 0.5 });
  });

  it("2026 : le solde de fin 2025 est le report ; le congé à cheval compte 4 j ici (3 j en 2025), 8 j pris en tout", () => {
    expect(bilans[1]).toMatchObject({ report: 0.5, acquisAnnee: 13.5, pris: 8, perdu: 0, solde: 6 });
  });

  it("la part de chaque année s'additionne au nombre de jours saisis (aucun jour perdu ni compté deux fois)", () => {
    const cheval = repartirCongeParJour({ dateDebut: jour("2025-12-29"), dateFin: jour("2026-01-06"), nbJours: 7 }, feries);
    const part = (a: number) => cheval.filter((x) => x.date.getUTCFullYear() === a).reduce((s, x) => s + x.jours, 0);
    expect(part(2025) + part(2026)).toBeCloseTo(7, 9);
    expect([part(2025), part(2026)]).toEqual([3, 4]);
  });

  it("l'année en cours est EXACTEMENT ce que rend calculerSoldeAnneeCivile (le solde de l'en-tête de la fiche)", () => {
    const { enCours, ...bilan } = bilans[1];
    expect(enCours).toBe(true);
    expect(bilan).toEqual(calculerSoldeAnneeCivile(entrees));
  });

  it("une année passée est ce que rend calculerSoldeAnneeCivile arrêté au 31 décembre de cette année", () => {
    const { enCours, ...bilan } = bilans[0];
    expect(enCours).toBe(false);
    expect(bilan).toEqual(calculerSoldeAnneeCivile({ ...entrees, aujourdhui: jour("2025-12-31") }));
  });

  it("cohérence : report + acquis − perdus − pris = solde (au dixième), et le report d'une année est le solde de la précédente", () => {
    for (const [i, b] of bilans.entries()) {
      expect(Math.abs(b.report + b.acquisAnnee - b.perdu - b.pris - b.solde)).toBeLessThan(0.11);
      if (i > 0) expect(b.report).toBe(bilans[i - 1].solde);
    }
  });

  it("plafond : le reliquat reporté qui fait dépasser 18 j est perdu dans l'année où il se perd", () => {
    const [b2025, b2026] = bilansParAnnee({ dateEmbauche: jour("2025-01-01"), aujourdhui: jour("2026-10-12"), droitsAnnuels: 18, sansConges: false, prisParJour: [] });
    expect(b2025).toMatchObject({ report: 0, solde: 16.5, perdu: 0 });
    expect(b2026).toMatchObject({ report: 16.5, solde: 18, perdu: 13.5 });
  });

  it("reliquat négatif (congé pris par anticipation) : reporté tel quel", () => {
    const [b2025, b2026] = bilansParAnnee({
      dateEmbauche: jour("2025-10-01"), aujourdhui: jour("2026-03-15"), droitsAnnuels: 18, sansConges: false,
      prisParJour: repartirCongeParJour({ dateDebut: jour("2025-12-15"), dateFin: jour("2025-12-19"), nbJours: 5 }, new Set()),
    });
    expect(b2025.solde).toBe(-2);
    expect(b2026).toMatchObject({ report: -2, solde: 2.5 });
  });

  it("embauché cette année : une seule ligne", () => {
    expect(bilansParAnnee({ dateEmbauche: jour("2026-03-20"), aujourdhui: jour("2026-10-12"), droitsAnnuels: 18, sansConges: false, prisParJour: [] }).map((b) => b.annee)).toEqual([2026]);
  });
});
