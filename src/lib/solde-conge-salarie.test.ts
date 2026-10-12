import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { calculerSoldeAnneeCivile, repartirCongeParJour } from "./solde-conge-salarie";

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const AUJ = jour("2026-10-12");
const base = { aujourdhui: AUJ, droitsAnnuels: 18, sansConges: false };
/** Un congé de n jours ouvrables consécutifs à partir d'un lundi (sans férié), réparti jour par jour. */
const conge = (debut: string, fin: string, n: number) => repartirCongeParJour({ dateDebut: jour(debut), dateFin: jour(fin), nbJours: n }, new Set());

// Décisions de la Direction du 2026-10-12 : ANNÉE CIVILE pour les acquis ET les pris, RELIQUAT
// reporté, et (Sacha, 2026-10-12, second arbitrage) SOLDE ≤ 18 j À TOUT INSTANT : l'acquisition qui
// le ferait dépasser est perdue au-delà, jamais « report + acquis de l'année ≤ 18 ».
describe("calculerSoldeAnneeCivile — année civile, report, solde plafonné à tout instant", () => {
  it("le cas de Sacha : 18 j reportés pris en janvier → de nouveau 13,5 j en octobre", () => {
    // Embauché le 1er : un mois s'achève chaque 1er. Janvier : solde déjà à 18, l'acquis du 01/01 est perdu.
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2020-03-01"), prisParJour: conge("2026-01-05", "2026-01-26", 18) });
    expect(r).toMatchObject({ report: 18, pris: 18, solde: 13.5, plafonne: true, perdu: 1.5, acquisAnnee: 15 });
    expect(r.acquis).toBe(31.5); // droits = solde + pris : report 18 + 15 acquis − 1,5 perdu
  });

  it("ancien salarié sans historique, 5 j pris en mars : le solde remonte au plafond, jamais au-delà", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2020-03-01"), prisParJour: conge("2026-03-02", "2026-03-06", 5) });
    // 13 après le congé, + 1,5 chaque 1er du mois d'avril à octobre (10,5) → 23,5 plafonné à 18.
    expect(r).toMatchObject({ report: 18, pris: 5, solde: 18, plafonne: true });
    // Ancienne règle : 18 − 5 = 13.
  });

  it("reliquat reporté : embauché le 20/03/2025, 10 j pris en 2025 → report 3,5 ; 4 pris en 2026 → 13", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2025-03-20"), prisParJour: [...conge("2025-11-03", "2025-11-14", 10), ...conge("2026-08-03", "2026-08-06", 4)] });
    // 2025 : 9 mois révolus (20/04 → 20/12) = 13,5 − 10 = 3,5 ; 2026 : 9 mois (20/01 → 20/09) = 13,5 ; 17 − 4 = 13.
    expect(r).toMatchObject({ report: 3.5, acquisAnnee: 13.5, acquis: 17, plafonne: false, pris: 4, solde: 13 });
  });

  it("le solde affiché ne dépasse jamais 18 : rien pris depuis l'embauche → 18", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2025-01-01"), prisParJour: [] });
    // 31/12/2025 : 11 mois révolus = 16,5 reportés ; le 12e mois s'achève le 01/01/2026 → 18, le reste est perdu.
    expect(r).toMatchObject({ report: 16.5, solde: 18, plafonne: true, perdu: 13.5 });
  });

  it("reliquat NÉGATIF (congé pris par anticipation) : reporté et repris sur l'année suivante", () => {
    const r = calculerSoldeAnneeCivile({ ...base, aujourdhui: jour("2026-03-15"), dateEmbauche: jour("2025-10-01"), prisParJour: conge("2025-12-15", "2025-12-19", 5) });
    // 2025 : 01/11, 01/12 = 3 j (le 01/01 tombe en 2026) − 5 → −2 ; 2026 : 01/01, 01/02, 01/03 = 4,5 → 2,5.
    expect(r).toMatchObject({ report: -2, acquisAnnee: 4.5, solde: 2.5, pris: 0 });
  });

  it("embauché dans l'année : ni report ni plafond, mois révolus seulement", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2026-03-20"), prisParJour: [] });
    expect(r).toMatchObject({ report: 0, acquisAnnee: 9, acquis: 9, solde: 9, plafonne: false }); // 6 mois révolus au 12/10
  });

  it("« C » sans demande : déduits le jour où ils tombent (report compris)", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: jour("2025-07-01"), prisParJour: [], cSansDemande: [jour("2025-11-04"), jour("2025-11-05"), jour("2026-02-03")] });
    // 2025 : 01/08 → 01/12 = 7,5 − 2 = 5,5 reportés ; 2026 : 01/01 → 01/10 = 15 → 20,5 plafonné à 18 avant le 01/10, − 1 le 03/02.
    expect(r).toMatchObject({ report: 5.5, cSansDemande: 1, pris: 1, solde: 18, plafonne: true });
  });

  it("stage ou intérim : rien d'acquis, le pris se décompte", () => {
    const r = calculerSoldeAnneeCivile({ ...base, sansConges: true, dateEmbauche: jour("2025-01-01"), prisParJour: conge("2026-02-02", "2026-02-03", 2) });
    expect(r).toMatchObject({ acquis: 0, report: 0, pris: 2, solde: -2 });
  });
});

describe("repartirCongeParJour — un congé à cheval sur deux années", () => {
  it("29/12/2025 → 06/01/2026, 1er janvier férié : 3 j sur 2025, 4 j sur 2026", () => {
    const parts = repartirCongeParJour({ dateDebut: jour("2025-12-29"), dateFin: jour("2026-01-06"), nbJours: 7 }, new Set(["2026-01-01"]));
    const parAnnee = (y: number) => parts.filter((p) => p.date.getUTCFullYear() === y).reduce((s, p) => s + p.jours, 0);
    expect([parAnnee(2025), parAnnee(2026)]).toEqual([3, 4]);
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
