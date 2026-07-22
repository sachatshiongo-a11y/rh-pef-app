import { describe, expect, it } from "vitest";
import {
  calculerJoursOuvrables,
  calculerHeuresSupp,
  numeroSemaineDuMois,
  calculerIprDGI,
  calculerPaieBackoffice,
  calculerPaieBrigade,
  calculerCongesAcquis,
  congeDeductibleDuSolde,
  tauxPrimeAnciennete,
  resumerPresences,
  type ParametresPaie,
} from "./payroll";

// Paramètres de test = valeurs seed de l'exercice 2026 (À VALIDER par un comptable).
// Dans l'application, ces valeurs viennent de la table ParametreLegal, jamais du code.
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
  iprBase: 2, // brut − CNSS salariale

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

describe("calculerIprDGI — barème DGI (seuils mensuels = annuels ÷ 12)", () => {
  // Seuils mensuels : 162 000 (3%) ; 1 800 000 (15%) ; 3 600 000 (30%) ; au-delà 40%.

  it("cas vérifiable à la main : 500 000 FC/mois, sans personne à charge", () => {
    // 162 000 × 3% = 4 860 ; (500 000 − 162 000) × 15% = 50 700 → total 55 560 FC
    expect(calculerIprDGI(500_000, params, 0)).toBeCloseTo(55_560, 2);
  });

  it("cas vérifiable à la main : 2 500 000 FC/mois, sans personne à charge", () => {
    // 4 860 + (1 800 000−162 000)×15% = 245 700 + (2 500 000−1 800 000)×30% = 210 000 → 460 560
    expect(calculerIprDGI(2_500_000, params, 0)).toBeCloseTo(460_560, 2);
  });

  it("applique la réduction pour charges de famille (2%/personne, max 9)", () => {
    const sansCharge = calculerIprDGI(500_000, params, 0);
    // 3 personnes → −6%
    expect(calculerIprDGI(500_000, params, 3)).toBeCloseTo(sansCharge * 0.94, 2);
    // 15 personnes → plafonné à 9 → −18%
    expect(calculerIprDGI(500_000, params, 15)).toBeCloseTo(sansCharge * 0.82, 2);
  });

  it("applique le plancher de 2 000 FC/mois sur les petits revenus", () => {
    // 30 000 FC → 3% = 900 FC < plancher → 2 000 FC
    expect(calculerIprDGI(30_000, params, 0)).toBe(2000);
  });

  it("ne dépasse jamais le plafond de 30% du revenu imposable", () => {
    const base = 100_000_000; // très haut revenu, taux marginal 40%
    expect(calculerIprDGI(base, params, 0)).toBeLessThanOrEqual(base * 0.3);
  });

  it("retourne 0 pour une base nulle (pas de plancher sur salaire à zéro)", () => {
    expect(calculerIprDGI(0, params, 0)).toBe(0);
  });
});

describe("calculerPaieBrigade — chaîne complète paramétrée", () => {
  it("cas vérifiable à la main : 26 jours × 8h à 1,25 $/h = 260 $, 1 enfant", () => {
    const r = calculerPaieBrigade(
      {
        salaireJournalier: 10,
        salaireHoraire: 1.25,
        heuresNormales: 208, // 26 jours × 8 h → base 208 × 1,25 = 260 $
        joursPayesNonTravailles: 0,
        joursPayes2_3: 0,
        hsValorisee: 0,
        transportMoisUSD: 0,
        enfants: 1,
      },
      params
    );

    // Brut 260 $ ; CNSS salarié 5% = 13 $ ; base imposable 247 $ = 568 100 FC
    expect(r.salBrutUSD).toBeCloseTo(260, 6);
    expect(r.cnssSalarieUSD).toBeCloseTo(13, 6);
    expect(r.netImposableUSD).toBeCloseTo(247, 6);

    // IPR : 4 860 + (568 100 − 162 000) × 15% = 65 775 FC, réduction 1 pers. −2% → 64 459,5 FC
    const iprAttenduCDF = (4860 + (568_100 - 162_000) * 0.15) * 0.98;
    expect(r.iprCalculeUSD).toBeCloseTo(iprAttenduCDF / 2300, 4);

    // Charges patronales : CNSS 13% = 33,8 $ ; INPP 3% = 7,8 $ ; ONEM 0,2% = 0,52 $
    expect(r.cnssPatronalUSD).toBeCloseTo(260 * 0.13, 6);
    expect(r.inppUSD).toBeCloseTo(7.8, 6);
    expect(r.onemUSD).toBeCloseTo(0.52, 6);
    expect(r.coutEmployeurUSD).toBeCloseTo(260 + 33.8 + 7.8 + 0.52, 6);

    // Net = brut − CNSS − IPR + alloc (1,5 $) — cohérence interne
    expect(r.salNetUSD).toBeCloseTo(260 - 13 - r.iprCalculeUSD + 1.5, 6);
    expect(r.salNetCDF).toBeCloseTo(r.salNetUSD * 2300, 2);
  });

  it("applique le plafond CNSS quand il est défini", () => {
    const avecPlafond = { ...params, plafondCnssMensuelCDF: 230_000 }; // = 100 $
    const r = calculerPaieBrigade(
      {
        salaireJournalier: 10,
        salaireHoraire: 1.25,
        heuresNormales: 208, // brut 260 $ > plafond 100 $
        joursPayesNonTravailles: 0,
        joursPayes2_3: 0,
        hsValorisee: 0,
        transportMoisUSD: 0,
        enfants: 0,
      },
      avecPlafond
    );
    expect(r.cnssSalarieUSD).toBeCloseTo(100 * 0.05, 6);
    expect(r.cnssPatronalUSD).toBeCloseTo(100 * 0.13, 6);
  });
});

describe("calculerPaieBackoffice", () => {
  it("le transport est NON IMPOSABLE et NON COTISABLE : versé au net, hors assiettes CNSS/IPR/INPP/ONEM", () => {
    const r = calculerPaieBackoffice(
      { salaireBaseUSD: 200, transportUSD: 20, enfants: 0 },
      params
    );
    // Le brut versé inclut le transport…
    expect(r.salBrutUSD).toBeCloseTo(220, 6);
    // …mais toutes les assiettes sont calculées sur 200 (hors transport).
    expect(r.cnssSalarieUSD).toBeCloseTo(200 * 0.05, 6);
    expect(r.inppUSD).toBeCloseTo(200 * 0.03, 6);
    expect(r.onemUSD).toBeCloseTo(200 * 0.002, 6);
    // Et l'IPR est identique à celui d'un salaire de 200 SANS transport.
    const sansTransport = calculerPaieBackoffice({ salaireBaseUSD: 200, transportUSD: 0, enfants: 0 }, params);
    expect(r.iprCalculeUSD).toBeCloseTo(sansTransport.iprCalculeUSD, 6);
    // Le net = net sans transport + 20 $ (le transport arrive intégralement au net).
    expect(r.salNetUSD).toBeCloseTo(sansTransport.salNetUSD + 20, 6);
  });
});

describe("calculerHeuresSupp — seuil hebdo et majorations paramétrés", () => {
  const salaireHoraire = 1;
  const joursFeries = new Set(["2026-06-30"]);

  it("6 premières heures supp. de la semaine à +30%, le reste à +60%", () => {
    const jours = [1, 2, 3, 4, 5, 6].map((d) => ({
      date: new Date(`2026-06-0${d}T00:00:00Z`),
      heuresTravaillees: 10,
    })); // 60h normales, hebdo contractuel 48h → excédent 12h
    const r = calculerHeuresSupp({
      jours,
      heuresParJourContrat: 8,
      heuresHebdoContrat: 48,
      salaireHoraire,
      joursFeries,
      params,
    });
    expect(r.hs30).toBe(6);
    expect(r.hs60).toBe(6);
    // Valorisation complète : 6 h × 1,30 + 6 h × 1,60 (base non payée par ailleurs pour ces heures).
    expect(r.hsValorisee).toBeCloseTo(6 * 1.3 + 6 * 1.6, 6);
  });

  it("dimanche/férié : TOUTES les heures comptées (hs100), valorisées à la prime seule", () => {
    // La journée de base est payée par le code de présence (P/F) ; ici on ne teste que la prime.
    const r = calculerHeuresSupp({
      jours: [{ date: new Date("2026-06-07T00:00:00Z"), heuresTravaillees: 10 }], // dimanche, 10h
      heuresParJourContrat: 8,
      heuresHebdoContrat: 48,
      salaireHoraire,
      joursFeries,
      params,
    });
    expect(r.hs100).toBe(10); // toutes les heures, pas seulement l'excédent
    expect(r.hs30).toBe(0); // hors tranches
    expect(r.hs60).toBe(0);
    expect(r.hsValorisee).toBeCloseTo(10 * 2.0, 6); // dimanche : payé double (taux × 2)
  });

  it("B1 : 6h un jour férié (< quota) sont comptées et primées, jamais 0", () => {
    const r = calculerHeuresSupp({
      jours: [{ date: new Date("2026-06-30T00:00:00Z"), heuresTravaillees: 6 }], // férié (joursFeries)
      heuresParJourContrat: 7.5,
      heuresHebdoContrat: 45,
      salaireHoraire,
      joursFeries,
      params,
    });
    expect(r.heuresTotalesMois).toBe(6); // affiché tel que saisi
    expect(r.hs100).toBe(6);
    expect(r.hs30).toBe(0);
    expect(r.hs60).toBe(0);
    expect(r.hsValorisee).toBeCloseTo(6 * 2.0, 6); // férié : payé double (taux × 2), plus jamais 0
  });

  it("le seuil hebdo est configurable (ex. 4h au lieu de 6h)", () => {
    const paramsSeuil4 = { ...params, hsSeuilHebdoH: 4 };
    const jours = [1, 2, 3, 4, 5, 6].map((d) => ({
      date: new Date(`2026-06-0${d}T00:00:00Z`),
      heuresTravaillees: 10,
    }));
    const r = calculerHeuresSupp({
      jours,
      heuresParJourContrat: 8,
      heuresHebdoContrat: 48,
      salaireHoraire,
      joursFeries,
      params: paramsSeuil4,
    });
    expect(r.hs30).toBe(4);
    expect(r.hs60).toBe(8);
  });
});

describe("numeroSemaineDuMois — vraies semaines lundi→dimanche", () => {
  const j = (iso: string) => new Date(iso + "T00:00:00Z");
  it("mois commençant un lundi (juin 2026) : 1-7 = sem.1, 8 = sem.2", () => {
    expect(numeroSemaineDuMois(j("2026-06-01"))).toBe(1); // lundi
    expect(numeroSemaineDuMois(j("2026-06-07"))).toBe(1); // dimanche
    expect(numeroSemaineDuMois(j("2026-06-08"))).toBe(2); // lundi suivant
  });
  it("mois commençant un mercredi (juillet 2026) : 1-5 = sem.1, 6 = sem.2", () => {
    expect(numeroSemaineDuMois(j("2026-07-01"))).toBe(1); // mercredi
    expect(numeroSemaineDuMois(j("2026-07-05"))).toBe(1); // dimanche
    expect(numeroSemaineDuMois(j("2026-07-06"))).toBe(2); // lundi
  });
});

describe("resumerPresences", () => {
  it("P/O/A/C/F payés 100%, M à 2/3, N/S non payés", () => {
    const codes = ["P", "P", "O", "M", "A", "N", "C", "F", "S"] as const;
    const resume = resumerPresences([...codes]);
    expect(resume.payes100).toBe(6);
    expect(resume.payes2_3).toBe(1);
    expect(resume.nonPayes).toBe(2);
    expect(resume.totalPresence).toBe(7);
  });
});

describe("calculerCongesAcquis", () => {
  it("prorata sous 12 mois, droits complets au-delà", () => {
    expect(calculerCongesAcquis(3, 18)).toBeCloseTo(4.5, 5);
    expect(calculerCongesAcquis(12, 18)).toBe(18);
    expect(calculerCongesAcquis(38, 18)).toBe(18);
  });

  it("acquisition = 1,5 j/mois (mois révolus) plafonnée à 18", () => {
    // 18 jours annuels ⇒ 1,5 j par mois d'ancienneté.
    expect(calculerCongesAcquis(1, 18)).toBeCloseTo(1.5, 5);
    expect(calculerCongesAcquis(6, 18)).toBeCloseTo(9, 5);
    expect(calculerCongesAcquis(11, 18)).toBeCloseTo(16.5, 5);
    // Le mois en cours n'est PAS crédité : l'appelant passe des mois révolus (décision produit).
    expect(calculerCongesAcquis(0, 18)).toBe(0);
  });
});

describe("congeDeductibleDuSolde (déductibilité du solde de congés payés)", () => {
  it("congé annuel / autre : déductibles (tauxPct non fourni, > 0, ou null → payé par défaut)", () => {
    expect(congeDeductibleDuSolde("Congé annuel payé")).toBe(true);
    expect(congeDeductibleDuSolde("Congé annuel payé", 100)).toBe(true);
    expect(congeDeductibleDuSolde("Congé annuel payé", null)).toBe(true); // À VALIDER = payé par défaut
    expect(congeDeductibleDuSolde("Autre")).toBe(true);
    expect(congeDeductibleDuSolde("Mariage")).toBe(true);
    expect(congeDeductibleDuSolde("Décès d'un proche")).toBe(true);
  });

  it("congé sans solde (tauxPct = 0) : NON déductible — ne doit pas entamer le solde payé", () => {
    expect(congeDeductibleDuSolde("Congé sans solde", 0)).toBe(false);
    // sans info de tauxPct (appelant non migré / type inconnu), comportement historique conservé
    expect(congeDeductibleDuSolde("Congé sans solde")).toBe(true);
  });

  it("maternité / paternité / naissance / maladie / accident : NON déductibles quel que soit le taux", () => {
    expect(congeDeductibleDuSolde("Congé maternité")).toBe(false);
    expect(congeDeductibleDuSolde("Congé maternité", 100)).toBe(false);
    expect(congeDeductibleDuSolde("Congé maternité", 0)).toBe(false);
    expect(congeDeductibleDuSolde("Congé paternité / naissance")).toBe(false);
    expect(congeDeductibleDuSolde("CONGÉ MALADIE")).toBe(false);
    expect(congeDeductibleDuSolde("Maladie professionnelle")).toBe(false);
    expect(congeDeductibleDuSolde("Accident du travail")).toBe(false);
    expect(congeDeductibleDuSolde("Naissance (arrivée d'un enfant)")).toBe(false);
  });
});

describe("tauxPrimeAnciennete — barème RDC (0% <3 ans, +1%/an, plafond 25%)", () => {
  it("aucune prime avant 3 ans d'ancienneté", () => {
    expect(tauxPrimeAnciennete(0)).toBe(0);
    expect(tauxPrimeAnciennete(2)).toBe(0);
    expect(tauxPrimeAnciennete(2.9)).toBe(0);
  });

  it("3% dès 3 ans, +1% par année accomplie", () => {
    expect(tauxPrimeAnciennete(3)).toBe(3);
    expect(tauxPrimeAnciennete(7)).toBe(7);
    expect(tauxPrimeAnciennete(10)).toBe(10);
  });

  it("compte en années ENTIÈRES accomplies (troncature)", () => {
    expect(tauxPrimeAnciennete(4.9)).toBe(4);
    expect(tauxPrimeAnciennete(3.99)).toBe(3);
  });

  it("plafonné à 25%", () => {
    expect(tauxPrimeAnciennete(25)).toBe(25);
    expect(tauxPrimeAnciennete(30)).toBe(25);
    expect(tauxPrimeAnciennete(50)).toBe(25);
  });

  it("montant mensuel = salaire de base × taux (ex. 700 $ à 7 ans = 49 $)", () => {
    const salaireBase = 700;
    const montant = salaireBase * (tauxPrimeAnciennete(7) / 100);
    expect(montant).toBeCloseTo(49, 5);
  });
});

describe("calculerJoursOuvrables — dimanches et jours fériés exclus", () => {
  // Lundi 29 juin → dimanche 5 juillet 2026 : 7 jours calendaires, 1 dimanche.
  it("exclut les dimanches", () => {
    expect(calculerJoursOuvrables(new Date("2026-06-29"), new Date("2026-07-05"))).toBe(6);
  });
  it("exclut aussi les jours fériés fournis (ex. 30 juin, indépendance RDC)", () => {
    expect(calculerJoursOuvrables(new Date("2026-06-29"), new Date("2026-07-05"), [new Date("2026-06-30")])).toBe(5);
  });
  it("un férié tombant un dimanche n'est pas déduit deux fois", () => {
    expect(calculerJoursOuvrables(new Date("2026-06-29"), new Date("2026-07-05"), [new Date("2026-07-05")])).toBe(6);
  });
});
