import { describe, expect, it } from "vitest";
import { calculerPaieBackoffice, type ParametresPaie } from "./payroll";

// Paramètres légaux = valeurs de l'exercice 2026 telles qu'utilisées EN PRODUCTION.
// (Copie de ceux de payroll.test.ts : si les deux fichiers divergent, un test cassera.)
// ⚠️ À FAIRE VALIDER par un comptable/juriste congolais — voir la table ParametreLegal.
const params: ParametresPaie = {
  tauxChangeCDF: 2300,
  cnssSalarie: 0.05,
  cnssPatronalPensions: 0.05,
  cnssPatronalRisques: 0.015,
  cnssPatronalFamille: 0.065,
  plafondCnssMensuelCDF: null,
  iprTranchesAnnuellesCDF: [
    { ordre: 1, plafondAnnuelCDF: 1_944_000, taux: 0.03 },
    { ordre: 2, plafondAnnuelCDF: 21_600_000, taux: 0.15 },
    { ordre: 3, plafondAnnuelCDF: 43_200_000, taux: 0.3 },
    { ordre: 4, plafondAnnuelCDF: null, taux: 0.4 },
  ],
  iprPlancherMensuelCDF: 2000,
  iprPlafondTaux: 0.3,
  iprReductionFamilleTaux: 0.02,
  iprReductionFamilleMax: 9,
  iprBase: 2, // base IPR = brut − CNSS salariale
  inppTaux: 0.03,
  onemTaux: 0.002,
  hsSeuilHebdoH: 6,
  hsMajTranche1: 0.3,
  hsMajTranche2: 0.6,
  hsMajDimancheFerie: 1.0,
  allocFamilialeParEnfantUSD: 1.5,
  joursOuvrablesMois: 26,
  droitsCongesAnnuel: 18,
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  BULLETINS DE RÉFÉRENCE (« golden master »)
 * ════════════════════════════════════════════════════════════════════════════
 * Figés depuis la paie RÉELLE de juillet 2026 (production). Chaque cas verrouille
 * toute la chaîne fiscale : brut → CNSS → base imposable → IPR (barème DGI) →
 * allocation familiale → NET, sur de vrais salariés.
 *
 * ⚠️  À FAIRE VALIDER PAR LE COMPTABLE : une fois qu'il confirme que le « net »
 *     de chaque salarié ci-dessous est correct, ces valeurs deviennent la
 *     RÉFÉRENCE officielle. Toute modification future du code qui changerait un
 *     de ces montants fera ÉCHOUER le test → la régression est détectée avant
 *     d'atteindre un vrai bulletin.
 *
 * 🔁  Pour re-figer volontairement après un changement de barème VALIDÉ : mettre
 *     à jour les valeurs « attendu » ci-dessous, en notant la date et la source.
 *
 * Note technique : on injecte le brut réel comme base (transport/HS/primes y sont
 * déjà inclus) afin de tester précisément la transformation brut → net, qui est
 * la partie la plus sensible juridiquement. La COMPOSITION du brut (heures, HS,
 * transport) est couverte par payroll.test.ts.
 * ════════════════════════════════════════════════════════════════════════════
 */
type CasReference = {
  nom: string;
  brutUSD: number;
  enfants: number;
  fraisMedicauxUSD?: number;
  acompteUSD?: number;
  attendu: { cnss: number; baseImposable: number; ipr: number; alloc: number; netUSD: number };
};

const REFERENCES: CasReference[] = [
  { nom: "Coco Lala", brutUSD: 417.93, enfants: 3, attendu: { cnss: 20.9, baseImposable: 397.04, ipr: 48.04, alloc: 4.5, netUSD: 353.5 } },
  { nom: "Martine Mutombo", brutUSD: 535.65, enfants: 2, attendu: { cnss: 26.78, baseImposable: 508.87, ipr: 65.16, alloc: 3.0, netUSD: 446.71 } },
  { nom: "Jeannette Bongota", brutUSD: 485.65, enfants: 1, attendu: { cnss: 24.28, baseImposable: 461.37, ipr: 59.54, alloc: 1.5, netUSD: 403.33 } },
  { nom: "Caprice Bokole", brutUSD: 290.43, enfants: 2, attendu: { cnss: 14.52, baseImposable: 275.91, ipr: 31.62, alloc: 3.0, netUSD: 247.3 } },
  { nom: "Deladri Losole", brutUSD: 285.65, enfants: 1, attendu: { cnss: 14.28, baseImposable: 271.37, ipr: 31.61, alloc: 1.5, netUSD: 241.26 } },
];

describe("Bulletins de référence (golden master) — brut → net, salariés réels juillet 2026", () => {
  for (const c of REFERENCES) {
    it(`${c.nom} : brut ${c.brutUSD} $, ${c.enfants} enfant(s) → net ${c.attendu.netUSD} $`, () => {
      const r = calculerPaieBackoffice(
        {
          salaireBaseUSD: c.brutUSD,
          transportUSD: 0,
          enfants: c.enfants,
          fraisMedicauxUSD: c.fraisMedicauxUSD ?? 0,
          primesUSD: 0,
          acompteUSD: c.acompteUSD ?? 0,
        },
        params
      );
      // Tolérance 0,05 $ (les montants stockés sont arrondis à 2 décimales).
      expect(r.salBrutUSD).toBeCloseTo(c.brutUSD, 2);
      expect(r.cnssSalarieUSD).toBeCloseTo(c.attendu.cnss, 1);
      expect(r.netImposableUSD).toBeCloseTo(c.attendu.baseImposable, 1);
      expect(r.iprCalculeUSD).toBeCloseTo(c.attendu.ipr, 1);
      expect(r.allocFamilialeUSD).toBeCloseTo(c.attendu.alloc, 2);
      expect(r.salNetUSD).toBeCloseTo(c.attendu.netUSD, 1);
    });
  }
});
