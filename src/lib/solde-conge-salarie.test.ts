import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { calculerSoldeAnneeCivile, repartirCongeParAnnee } from "./solde-conge-salarie";

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const AUJ = jour("2026-10-12");
const base = { aujourdhui: AUJ, droitsAnnuels: 18, sansConges: false };

// Décisions de la Direction du 2026-10-12 : ANNÉE CIVILE pour les acquis ET les pris, RELIQUAT
// reporté, report + acquis de l'année plafonnés à 18 j.
describe("calculerSoldeAnneeCivile — année civile, report, plafond", () => {
  it("ancien salarié sans historique : 18 j de droits (report plafonné), 13,5 j acquis cette année, 5 pris → 13", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2020-03-01"), prisParAnnee: new Map([[2026, 5]]) });
    // Acquis 2026 = 9 mois révolus (1er mars → 1er oct.) entre le 1er janvier et le 12 octobre = 13,5 j.
    expect(r).toEqual({ annee: 2026, acquis: 18, acquisAnnee: 13.5, report: 18, plafonne: true, pris: 5, cSansDemande: 0, solde: 13 });
  });

  it("reliquat reporté : embauché le 20/03/2025, 10 j pris en 2025 → report 3,5 ; 2026 = 3,5 + 13,5 = 17 ; 4 pris → 13", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2025-03-20"), prisParAnnee: new Map([[2025, 10], [2026, 4]]) });
    // 2025 : 9 mois révolus au 1er janvier 2026 (20/03 → 20/12) = 13,5 j ; 13,5 − 10 = 3,5 reportés.
    // 2026 : 18 mois révolus au 12/10 − 9 = 9 mois = 13,5 j. Ancienne règle : 18 − 4 = 14 (le pris de
    // 2025 était oublié au 1er janvier).
    expect(r).toMatchObject({ acquis: 17, acquisAnnee: 13.5, report: 3.5, plafonne: false, pris: 4, solde: 13 });
  });

  it("plafond : report + acquis de l'année ne dépassent jamais les droits annuels", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2025-01-01"), prisParAnnee: new Map() });
    // 2025 entier : 18 j acquis, rien pris → 18 reportés ; 2026 : 18 + 13,5 plafonnés à 18.
    expect(r).toMatchObject({ report: 18, acquisAnnee: 13.5, acquis: 18, plafonne: true, solde: 18 });
  });

  it("reliquat NÉGATIF (congé pris par anticipation) : reporté et repris sur l'année suivante", () => {
    const r = calculerSoldeAnneeCivile({ ...base, aujourdhui: jour("2026-03-15"), dateEmbauche: jour("2025-10-01"), prisParAnnee: new Map([[2025, 5]]) });
    // 2025 : 3 mois révolus = 4,5 j ; 5 pris → −0,5 reporté. 2026 au 15/03 : 2 mois = 3 j → 2,5.
    expect(r).toMatchObject({ report: -0.5, acquisAnnee: 3, acquis: 2.5, pris: 0, solde: 2.5 });
  });

  it("embauché dans l'année : ni report ni plafond, mois révolus seulement", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2026-03-20"), prisParAnnee: new Map() });
    expect(r).toMatchObject({ report: 0, acquisAnnee: 9, acquis: 9, solde: 9 }); // 6 mois révolus au 12/10
  });

  it("« C » sans demande : comptés dans l'année civile où ils tombent (report compris)", () => {
    const r = calculerSoldeAnneeCivile({
      ...base, dateEmbauche: jour("2025-07-01"), prisParAnnee: new Map(),
      cSansDemandeParAnnee: new Map([[2025, 2], [2026, 1]]),
    });
    // 2025 : 6 mois = 9 j − 2 C = 7 reportés ; 2026 : 9 mois = 13,5 → 18 (plafond) − 1 C = 17.
    expect(r).toMatchObject({ report: 7, acquis: 18, plafonne: true, pris: 1, cSansDemande: 1, solde: 17 });
  });

  it("stage ou intérim : rien d'acquis, le pris se décompte", () => {
    const r = calculerSoldeAnneeCivile({ ...base, sansConges: true, dateEmbauche: jour("2025-01-01"), prisParAnnee: new Map([[2026, 2]]) });
    expect(r).toMatchObject({ acquis: 0, report: 0, pris: 2, solde: -2 });
  });
});

describe("repartirCongeParAnnee — un congé à cheval sur deux années", () => {
  it("29/12/2025 → 06/01/2026, 1er janvier férié : 3 j sur 2025, 4 j sur 2026", () => {
    const parts = repartirCongeParAnnee({ dateDebut: jour("2025-12-29"), dateFin: jour("2026-01-06"), nbJours: 7 }, new Set(["2026-01-01"]));
    expect([...parts]).toEqual([[2025, 3], [2026, 4]]);
  });
  it("dans une seule année : le nombre saisi tel quel", () => {
    expect([...repartirCongeParAnnee({ dateDebut: jour("2026-03-02"), dateFin: jour("2026-03-06"), nbJours: 5 }, new Set())]).toEqual([[2026, 5]]);
  });
});

// Garde-fou : le solde se lit à UN endroit. Aucune page de l'espace salarié ne le recalcule — sinon
// deux écrans affichent de nouveau deux chiffres (défaut corrigé au lot 6).
function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("l'espace salarié lit le solde de congé à une seule source", () => {
  const racine = path.resolve(__dirname, "../app/espace");

  it("aucun fichier de src/app/espace ne calcule les congés acquis lui-même", () => {
    const fautifs = fichiers(racine).filter((f) => /\bcalculerCongesAcquis\b|\bcongeDeductibleDuSolde\b/.test(readFileSync(f, "utf8")));
    expect(fautifs.map((f) => path.relative(racine, f))).toEqual([]);
  });

  it("l'Accueil et « Mes congés » passent par chargerSoldeCongeSalarie", () => {
    for (const rel of ["page.tsx", "conges/page.tsx"]) {
      expect(readFileSync(path.join(racine, rel), "utf8"), rel).toMatch(/\bchargerSoldeCongeSalarie\(/);
    }
  });
});

// Décision 2026-09-28 : la fiche de la Direction lit le MÊME solde, à l'horloge (jamais
// Config.moisCourant, qui peut rester figé) — sinon Direction et salarié lisent deux soldes.
describe("la fiche employé de la Direction lit le même solde", () => {
  const fiche = readFileSync(path.resolve(__dirname, "../app/(app)/employes/[id]/page.tsx"), "utf8");
  it("passe par chargerSoldeCongeSalarie, sans date de référence tirée de Config", () => {
    expect(fiche).toMatch(/chargerSoldeCongeSalarie\(prisma, id\)/);
    expect(fiche).not.toMatch(/\bcalculerCongesAcquis\b|\bcongeDeductibleDuSolde\b/);
  });
});

// 2026-09-29 : les deux PDF qui impriment un solde (fiche employé, demande de congé) le lisaient
// encore sur Config.moisCourant → un PDF pouvait contredire l'écran. Ils passent par la même source.
describe("les PDF impriment le même solde que l'écran", () => {
  const pdfs = ["../app/(app)/employes/[id]/fiche/route.ts", "./pdf/demande-conge-buffer.ts"];
  for (const rel of pdfs) {
    it(`${rel} lit chargerSoldeCongeSalarie et ne recalcule rien`, () => {
      const src = readFileSync(path.resolve(__dirname, rel), "utf8");
      expect(src).toMatch(/\bchargerSoldeCongeSalarie\(prisma, /);
      expect(src).not.toMatch(/\bcalculerCongesAcquis\b|\bcongeDeductibleDuSolde\b|\bchargerCompteDansSoldeParType\b/);
    });
  }
});

// 2026-09-29 : le tableau des soldes du calendrier des congés recalculait le solde sur l'année
// AFFICHÉE, en jours ouvrables recomptés → un troisième chiffre. Il lit la source, en lot.
describe("le calendrier des congés affiche le même solde", () => {
  const cal = readFileSync(path.resolve(__dirname, "../app/(app)/conges/calendrier.tsx"), "utf8");
  it("passe par chargerSoldesCongeSalaries et ne recalcule ni droits ni décompte", () => {
    expect(cal).toMatch(/\bchargerSoldesCongeSalaries\(prisma, /);
    expect(cal).not.toMatch(/\bcalculerCongesAcquis\b|\bcongeDeductibleDuSolde\b|\bancienneteEnMois\b|\bcompteDansSolde\b/);
  });
});

import { compterCSansDemande } from "./solde-conge-salarie";

describe("compterCSansDemande — « C » de la grille sans demande approuvée (audit RH 2026-10-10)", () => {
  it("compte les C ouvrables non couverts ; jamais un dimanche, un férié, ni un jour couvert par une demande", () => {
    const c = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map(jour); // 04 = dimanche
    const n = compterCSansDemande(c, [{ dateDebut: jour("2026-10-07"), dateFin: jour("2026-10-09") }], new Set(["2026-10-05"]));
    expect(n).toBe(2); // 03 et 06
  });
});
