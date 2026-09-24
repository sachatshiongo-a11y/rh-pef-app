import { describe, expect, it } from "vitest";
import {
  calculerJoursOuvrables,
  calculerHeuresSupp,
  numeroSemaineDuMois,
  calculerIprDGI,
  calculerPaieBackoffice,
  calculerPaieBrigade,
  calculerPaieStage,
  calculerCongesAcquis,
  ancienneteEnMois,
  congeDeductibleDuSolde,
  tauxPrimeAnciennete,
  resumerPresences,
  reconstituerBrutDepuisNet,
  reconstitutionNetAuCentime,
  auCentime,
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
    // Argent au centime à la source (2026-09-24) : 64 459,5 FC ÷ 2 300 = 28,0259 $ → 28,03 $.
    expect(iprAttenduCDF / 2300).toBeCloseTo(28.0259, 4);
    expect(r.iprCalculeUSD).toBe(28.03);

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

// #3 — ancienneteEnMois : mois RÉVOLUS (compare aussi le jour du mois, pas seulement année/mois).
// Régression : avant le correctif, un employé était crédité d'un mois ~4 semaines trop tôt
// (dès le 1er du mois suivant l'embauche, sans attendre son anniversaire mensuel), ce qui
// gonflait à tort les congés acquis via calculerCongesAcquis.
describe("ancienneteEnMois — mois révolus (#3, régression)", () => {
  const j = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("embauche 2026-06-25, référence 2026-07-01 : 0 mois révolu (pas encore le 25 juillet)", () => {
    expect(ancienneteEnMois(j("2026-06-25"), j("2026-07-01"))).toBe(0);
  });

  it("référence EXACTEMENT à l'anniversaire mensuel : le mois est compté", () => {
    expect(ancienneteEnMois(j("2026-06-25"), j("2026-07-25"))).toBe(1);
  });

  it("référence 1 jour AVANT l'anniversaire mensuel : le mois n'est pas encore compté", () => {
    expect(ancienneteEnMois(j("2026-06-25"), j("2026-07-24"))).toBe(0);
  });

  it("référence 1 jour APRÈS l'anniversaire mensuel : le mois est compté", () => {
    expect(ancienneteEnMois(j("2026-06-25"), j("2026-07-26"))).toBe(1);
  });

  it("12 mois exactement révolus (embauche le 15, réf. un an plus tard le 15)", () => {
    expect(ancienneteEnMois(j("2025-07-15"), j("2026-07-15"))).toBe(12);
  });

  it("11 mois et 29 jours : pas encore 12 mois révolus", () => {
    expect(ancienneteEnMois(j("2025-07-15"), j("2026-07-14"))).toBe(11);
  });

  it("toujours ≥ 0, même si la référence est ANTÉRIEURE à l'embauche", () => {
    expect(ancienneteEnMois(j("2026-07-15"), j("2026-01-01"))).toBe(0);
  });

  it("embauche et référence le même jour du mois : 0 mois révolu à J+0", () => {
    expect(ancienneteEnMois(j("2026-07-15"), j("2026-07-15"))).toBe(0);
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

  // #3, régression combinée : avec la valeur CORRIGÉE d'ancienneteEnMois, un employé embauché
  // le 25 du mois n'a PAS son droit annuel complet dès le 1er du 13e mois calendaire (l'ancien
  // bug le lui aurait accordé ~4 semaines trop tôt) — il faut attendre le 25, 12 mois plus tard.
  it("n'accorde PAS le droit annuel complet avant 12 mois VRAIMENT révolus (ancienneteEnMois corrigé)", () => {
    const embauche = new Date("2025-07-25T00:00:00Z");
    // 1er juillet 2026 : calendairement "12 mois" au sens année/mois, mais le 25e jour n'est
    // pas encore atteint → 11 mois révolus seulement.
    const anciennete1erJuillet = ancienneteEnMois(embauche, new Date("2026-07-01T00:00:00Z"));
    expect(anciennete1erJuillet).toBe(11);
    expect(calculerCongesAcquis(anciennete1erJuillet, 18)).toBeCloseTo(16.5, 5);
    expect(calculerCongesAcquis(anciennete1erJuillet, 18)).toBeLessThan(18);

    // Le 25 juillet 2026 (anniversaire) : 12 mois révolus → droit annuel complet.
    const anciennete25Juillet = ancienneteEnMois(embauche, new Date("2026-07-25T00:00:00Z"));
    expect(anciennete25Juillet).toBe(12);
    expect(calculerCongesAcquis(anciennete25Juillet, 18)).toBe(18);
  });
});

describe("congeDeductibleDuSolde — la case sur le type décide, rien d'autre (2026-09-22)", () => {
  it("type coché → déduit du solde de congé annuel", () => {
    expect(congeDeductibleDuSolde(true)).toBe(true);
  });
  it("type décoché → non déduit, quel que soit son nom", () => {
    // Un « Congé annuel » décoché ne compte pas : la case prime sur le nom.
    expect(congeDeductibleDuSolde(false)).toBe(false);
  });
  it("type inconnu de la table (LeaveRequest.type est du texte libre) → non déduit", () => {
    expect(congeDeductibleDuSolde(undefined)).toBe(false);
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

describe("reconstituerBrutDepuisNet — inversion net→brut (salaires saisis en net, 2026-07-22)", () => {
  // Flag actif : le salaire de base saisi est un NET cible, le moteur reconstitue le brut.
  const paramsNet: ParametresPaie = { ...params, salairesSaisisEnNet: true };

  it("net ≤ 0 → brut 0", () => {
    expect(reconstituerBrutDepuisNet(0, params, 0)).toBe(0);
    expect(reconstituerBrutDepuisNet(-50, params, 0)).toBe(0);
  });

  it("gross-up positif : le brut reconstitué dépasse le net cible", () => {
    for (const net of [100, 200, 500, 900]) {
      expect(reconstituerBrutDepuisNet(net, params, 0)).toBeGreaterThan(net);
    }
  });

  it("strictement croissant avec le net cible", () => {
    const g100 = reconstituerBrutDepuisNet(100, params, 0);
    const g200 = reconstituerBrutDepuisNet(200, params, 0);
    const g500 = reconstituerBrutDepuisNet(500, params, 0);
    expect(g100).toBeLessThan(g200);
    expect(g200).toBeLessThan(g500);
  });

  it("round-trip net→brut→net ≈ identité (back-office, sans transport/prime/HS)", () => {
    // Le net perçu revient exactement au net cible (+ allocation familiale ajoutée après impôt),
    // avec un brut imposable strictement supérieur. Balayage de nets et de personnes à charge.
    for (const net of [80, 150, 250, 400, 750, 1200]) {
      for (const enfants of [0, 3]) {
        const r = calculerPaieBackoffice({ salaireBaseUSD: net, transportUSD: 0, enfants }, paramsNet);
        expect(r.salNetUSD).toBeCloseTo(net + enfants * params.allocFamilialeParEnfantUSD, 2);
        expect(r.salBrutUSD).toBeGreaterThan(net);
      }
    }
  });

  it("salaire net affiché = net promis AU CENTIME, transport compris (arrondis stockés à 2 décimales)", () => {
    // Constat production 2026-09-24 : Myriam (200 $ nets, transport 260 000 FC) affichait 200,01 $.
    // La base stocke total versé et transport ARRONDIS séparément ; le salaire net affiché est leur
    // différence. Une dichotomie arrêtée à 0,005 $ de brut laissait jusqu'à ~0,4 centime de trop,
    // qui basculait l'arrondi du total versé. Le net promis doit tomber juste au centime.
    const c2 = (x: number) => Math.round(x * 100) / 100;
    const transportsCDF = [0, 115_000, 130_000, 182_000, 208_000, 260_000];
    let ecarts = 0;
    for (const net of [150, 156, 200, 250, 300, 350, 400]) {
      for (const enfants of [0, 1, 2]) {
        for (const tcdf of transportsCDF) {
          const transportUSD = tcdf / params.tauxChangeCDF;
          const r = calculerPaieBackoffice({ salaireBaseUSD: net, transportUSD, enfants }, paramsNet);
          const affiche = c2(c2(r.salNetUSD) - c2(transportUSD)) - enfants * params.allocFamilialeParEnfantUSD;
          if (c2(affiche) !== net) ecarts++;
        }
      }
    }
    expect(ecarts).toBe(0);
    // Brigade (paie aux heures, t = S/R) : même exigence, cas Myriam (156 h, 260 000 FC).
    const b = calculerPaieBrigade({
      salaireJournalier: 0, salaireHoraire: 200 / 156, heuresNormales: 156, joursPayesNonTravailles: 0,
      joursPayes2_3: 0, hsValorisee: 0, transportMoisUSD: 260_000 / params.tauxChangeCDF, enfants: 0,
    }, paramsNet);
    expect(c2(c2(b.salNetUSD) - c2(260_000 / params.tauxChangeCDF))).toBe(200);
  });

  it("round-trip tenu même avec plafond CNSS défini", () => {
    const avecPlafond: ParametresPaie = { ...paramsNet, plafondCnssMensuelCDF: 230_000 }; // = 100 $
    const r = calculerPaieBackoffice({ salaireBaseUSD: 300, transportUSD: 0, enfants: 0 }, avecPlafond);
    expect(r.salNetUSD).toBeCloseTo(300, 2);
    expect(r.cnssSalarieUSD).toBeCloseTo(100 * 0.05, 2); // CNSS plafonnée à 100 $ × 5%
  });

  it("iprBase=1 (brut) exige un brut plus élevé que iprBase=2 (brut − CNSS) pour le même net", () => {
    const gBase1 = reconstituerBrutDepuisNet(300, { ...params, iprBase: 1 }, 0);
    const gBase2 = reconstituerBrutDepuisNet(300, { ...params, iprBase: 2 }, 0);
    expect(gBase1).toBeGreaterThan(gBase2);
  });

  it("flag OFF (défaut) : aucune reconstitution, le brut = le montant saisi (non-régression)", () => {
    const rBack = calculerPaieBackoffice({ salaireBaseUSD: 200, transportUSD: 0, enfants: 0 }, params);
    expect(rBack.salBrutUSD).toBeCloseTo(200, 6);
    const rBrig = calculerPaieBrigade(
      { salaireJournalier: 10, salaireHoraire: 1.25, heuresNormales: 208, joursPayesNonTravailles: 0, joursPayes2_3: 0, hsValorisee: 0, transportMoisUSD: 0, enfants: 0 },
      params
    );
    expect(rBrig.salBrutUSD).toBeCloseTo(260, 6);
  });

  it("brigade : la prime d'heures supp. est grossie par le même ratio ρ que la base", () => {
    const base = { salaireJournalier: 10, salaireHoraire: 1.25, heuresNormales: 208, joursPayesNonTravailles: 0, joursPayes2_3: 0, transportMoisUSD: 0, enfants: 0 };
    const sansHS = calculerPaieBrigade({ ...base, hsValorisee: 0 }, paramsNet);
    const avecHS = calculerPaieBrigade({ ...base, hsValorisee: 20 }, paramsNet);
    const netBaseCible = 1.25 * 208; // 260 $
    const rho = reconstituerBrutDepuisNet(netBaseCible, paramsNet, 0) / netBaseCible;
    // Seule la part HS diffère entre les deux : 20 × ρ dans le brut, arrondi au centime (2026-09-24 :
    // la prime HS grossie est un montant d'argent, arrondi au moment où il est produit).
    expect(avecHS.hsValorisee).toBe(Math.round(20 * rho * 100) / 100);
    expect(avecHS.salBrutUSD - sansHS.salBrutUSD).toBeCloseTo(avecHS.hsValorisee, 6);
  });

  it("STAGE : aucune reconstitution (net = brut, sans cotisations) même flag actif", () => {
    const r = calculerPaieStage({ indemniteUSD: 150, transportUSD: 0 }, paramsNet);
    expect(r.salBrutUSD).toBeCloseTo(150, 6);
    expect(r.salNetUSD).toBeCloseTo(150, 6);
    expect(r.cnssSalarieUSD).toBe(0);
    expect(r.iprCalculeUSD).toBe(0);
  });
});

describe("argent au centime, à la source (2026-09-24) — les lignes du bulletin s'additionnent", () => {
  const paramsNet: ParametresPaie = { ...params, salairesSaisisEnNet: true };
  // Ce que la base stocke : chaque montant à 2 décimales (numeric(12,2)), en centimes entiers ici
  // pour comparer sans bruit flottant.
  const ct = (x: number) => Math.round(x * 100);
  const transportsCDF = [0, 115_000, 130_000, 182_000, 208_000, 260_000];

  it("auCentime : demi-centime loin de zéro, sans bruit binaire (comme numeric(12,2))", () => {
    expect(auCentime(1.005)).toBe(1.01);
    expect(auCentime(174.8849)).toBe(174.88);
    expect(auCentime(135.65217)).toBe(135.65);
    expect(auCentime(-1.005)).toBe(-1.01);
    expect(auCentime(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(auCentime(-0.001), 0)).toBe(true);
  });

  type Cas = { nom: string; ligne: ReturnType<typeof calculerPaieBrigade>; netPromis: number | null; netBase: number | null };

  /** Balayage : nets 50 → 1 200 $, 0 à 3 enfants, transports réels, brigade et back-office. */
  function balayage(): Cas[] {
    const cas: Cas[] = [];
    const nets = [150, 156, 200, 156.37];
    for (let n = 50; n <= 1200; n += 23) nets.push(n);
    for (const net of nets) {
      for (const enfants of [0, 1, 2, 3]) {
        for (const tcdf of transportsCDF) {
          const transportUSD = tcdf / params.tauxChangeCDF;
          const R = 156 + (net % 3) * 26; // 156, 182 ou 208 h
          const t = net / R; // taux horaire (paie aux heures, t = S/R)
          const j = t * 8; // salaire journalier
          const brig = (e: Partial<Parameters<typeof calculerPaieBrigade>[0]>) =>
            calculerPaieBrigade({ salaireJournalier: j, salaireHoraire: t, heuresNormales: R, joursPayesNonTravailles: 0, joursPayes2_3: 0, hsValorisee: 0, transportMoisUSD: transportUSD, enfants, ...e }, paramsNet);
          const k = `${net} $ / ${enfants} enf. / ${tcdf} FC`;
          cas.push({ nom: `back-office ${k}`, ligne: calculerPaieBackoffice({ salaireBaseUSD: net, transportUSD, enfants }, paramsNet), netPromis: net, netBase: net });
          cas.push({ nom: `brigade complet ${k}`, ligne: brig({}), netPromis: net, netBase: net });
          // Jours payés non travaillés (congés, fériés, repos) : payés à 100 %, le net promis tient.
          cas.push({ nom: `brigade 3 j payés non travaillés ${k}`, ligne: brig({ heuresNormales: R - 24, joursPayesNonTravailles: 3 }), netPromis: net, netBase: net });
          // Maladie aux 2/3 : 2 jours → net de base = (R − 16) × t + 2 × j × 2/3.
          for (const m of [1, 2, 3, 5]) {
            cas.push({ nom: `brigade maladie ${m} j ${k}`, ligne: brig({ heuresNormales: R - 8 * m, joursPayes2_3: m }), netPromis: null, netBase: (R - 8 * m) * t + m * j * (2 / 3) });
          }
          cas.push({ nom: `brigade HS ${k}`, ligne: brig({ hsValorisee: t * 7.5 }), netPromis: null, netBase: null });
          cas.push({ nom: `brigade prime/acompte/prêt/frais ${k}`, ligne: brig({ primesUSD: 25, acompteUSD: 40, retenuePretUSD: 12.5, fraisMedicauxUSD: 7.3 }), netPromis: null, netBase: net });
        }
      }
    }
    return cas;
  }

  it("propriétés sur ~11 000 cas : brut = Σ gains, net = brut − retenues + allocations, coût = brut + charges, net promis exact", () => {
    const fautes: string[] = [];
    let nb = 0;
    for (const { nom, ligne: l, netPromis, netBase } of balayage()) {
      nb++;
      // Chaque montant est déjà au centime : la base le stocke tel quel.
      for (const [k, v] of Object.entries(l)) {
        if (k !== "facteurReconstitution" && typeof v === "number" && Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) fautes.push(`${nom} : ${k} = ${v} n'est pas au centime`);
      }
      const gains = ct(l.remuneration100) + ct(l.remuneration2_3) + ct(l.hsValorisee) + ct(l.transportUSD) + ct(l.primesUSD);
      if (ct(l.salBrutUSD) !== gains) fautes.push(`${nom} : brut ${l.salBrutUSD} ≠ Σ gains ${gains / 100}`);
      const net = ct(l.salBrutUSD) - ct(l.cnssSalarieUSD) - ct(l.iprCalculeUSD) + ct(l.allocFamilialeUSD) + ct(l.fraisMedicauxUSD) - ct(l.acompteUSD) - ct(l.retenuePretUSD);
      if (ct(l.salNetUSD) !== net) fautes.push(`${nom} : net ${l.salNetUSD} ≠ ${net / 100}`);
      if (ct(l.netImposableUSD) !== ct(l.salBrutUSD) - ct(l.transportUSD) - ct(l.cnssSalarieUSD)) fautes.push(`${nom} : base IPR`);
      const cout = ct(l.salBrutUSD) + ct(l.cnssPatronalUSD) + ct(l.inppUSD) + ct(l.onemUSD);
      if (ct(l.coutEmployeurUSD) !== cout) fautes.push(`${nom} : coût employeur`);
      // Net de base (hors transport, allocation, frais médicaux, acompte, prêt ET primes : les
      // primes ne sont pas grossies, leur part nette dépend de l'IPR) = cible au centime.
      if (netBase !== null && l.primesUSD === 0) {
        const netBaseObtenu = ct(l.salNetUSD) - ct(l.transportUSD) - ct(l.allocFamilialeUSD) - ct(l.fraisMedicauxUSD) + ct(l.acompteUSD) + ct(l.retenuePretUSD);
        if (netBaseObtenu !== ct(netBase)) fautes.push(`${nom} : net de base ${netBaseObtenu / 100} ≠ ${auCentime(netBase)}`);
      }
      // Répartition sur G : r100 + r2_3 = G exactement (G = brut de base reconstitué, au centime).
      if (netBase !== null && l.remuneration2_3 > 0) {
        const enf = Number(nom.split(" / ")[1].split(" ")[0]);
        const G = reconstituerBrutDepuisNet(auCentime(netBase), paramsNet, enf);
        if (ct(l.remuneration100) + ct(l.remuneration2_3) !== ct(G)) fautes.push(`${nom} : r100 + r2_3 = ${(ct(l.remuneration100) + ct(l.remuneration2_3)) / 100} ≠ G ${G}`);
      }
      if (netPromis !== null) {
        const horsTransportAlloc = ct(l.salNetUSD) - ct(l.transportUSD) - ct(l.allocFamilialeUSD);
        if (horsTransportAlloc !== ct(netPromis)) fautes.push(`${nom} : net hors transport/alloc ${horsTransportAlloc / 100} ≠ ${netPromis}`);
      }
    }
    expect(nb).toBeGreaterThan(10_000);
    expect(fautes.slice(0, 10)).toEqual([]);
  }, 60_000); // ~11 000 cas : plus de 5 s sur une machine chargée

  it("maladie aux 2/3 : r100 + r2_3 = G au centime, et le net de base tombe sur la cible", () => {
    const t = 200 / 208, j = t * 8;
    const l = calculerPaieBrigade({ salaireJournalier: j, salaireHoraire: t, heuresNormales: 192, joursPayesNonTravailles: 0, joursPayes2_3: 2, hsValorisee: 0, transportMoisUSD: 0, enfants: 1 }, paramsNet);
    const cible = auCentime(192 * t + 2 * j * (2 / 3));
    const G = reconstituerBrutDepuisNet(cible, paramsNet, 1);
    expect(ct(l.remuneration100) + ct(l.remuneration2_3)).toBe(ct(G));
    expect(ct(l.salNetUSD) - ct(l.allocFamilialeUSD)).toBe(ct(cible));
  });

  it("reconstitution : G est un nombre entier de centimes et le net obtenu est EXACTEMENT la cible", () => {
    for (const net of [50, 150, 151.5, 200, 287.15, 999.99, 1200]) {
      for (const enfants of [0, 1, 3]) {
        const r = reconstitutionNetAuCentime(net, paramsNet, enfants);
        expect(Math.abs(r.brutUSD * 100 - Math.round(r.brutUSD * 100))).toBeLessThan(1e-9);
        expect(r.exact).toBe(true);
        expect(ct(r.netObtenuUSD)).toBe(ct(net));
        // Et c'est le PLUS PETIT G : le back-office de brut G − 1 centime (flag OFF) paie moins.
        const moins = calculerPaieBackoffice({ salaireBaseUSD: r.brutUSD - 0.01, transportUSD: 0, enfants }, params);
        expect(ct(moins.salNetUSD) - ct(moins.allocFamilialeUSD)).toBeLessThan(ct(net));
      }
    }
  });

  it("cas Deladri (sept. 2026) : 150 $ nets, 1 enfant, 208 h, 12 000 FC × 26 j = 312 000 FC de transport", () => {
    const transport = (12_000 * 26) / params.tauxChangeCDF; // 135,652… $
    const l = calculerPaieBrigade({ salaireJournalier: (150 / 208) * 8, salaireHoraire: 150 / 208, heuresNormales: 208, joursPayesNonTravailles: 0, joursPayes2_3: 0, hsValorisee: 0, transportMoisUSD: transport, enfants: 1 }, paramsNet);
    expect(l.transportUSD).toBe(135.65);
    // Brut imposable affiché (brut − transport) = salaire de base affiché, au centime.
    expect(ct(l.salBrutUSD) - ct(l.transportUSD)).toBe(ct(l.remuneration100));
    expect(l.remuneration100).toBe(174.88);
    expect(l.salBrutUSD).toBe(310.53); // 174,88 + 135,65 (l'ancien moteur stockait 310,54)
    // Salaire net (hors transport) 151,50 $ = 150 $ promis + 1,50 $ d'allocation familiale.
    expect(ct(l.salNetUSD) - ct(l.transportUSD)).toBe(15_150);
    // Totaux (gains + allocation) − retenues = total versé.
    expect(ct(l.salBrutUSD) + ct(l.allocFamilialeUSD) - ct(l.cnssSalarieUSD) - ct(l.iprCalculeUSD)).toBe(ct(l.salNetUSD));
    expect(l.salNetUSD).toBe(287.15);
  });

  it("cas Myriam (sept. 2026) : 200 $ nets, 0 enfant, 156 h, 260 000 FC → salaire net 200,00 $", () => {
    const transport = 260_000 / params.tauxChangeCDF;
    const l = calculerPaieBrigade({ salaireJournalier: (200 / 156) * 8, salaireHoraire: 200 / 156, heuresNormales: 156, joursPayesNonTravailles: 0, joursPayes2_3: 0, hsValorisee: 0, transportMoisUSD: transport, enfants: 0 }, paramsNet);
    expect(ct(l.salNetUSD) - ct(l.transportUSD)).toBe(20_000);
    expect(ct(l.salBrutUSD) - ct(l.transportUSD)).toBe(ct(l.remuneration100));
  });

  it("back-office : le salaire de base est porté par remuneration100 (plus de « Salaire de base 0,00 $ »)", () => {
    const l = calculerPaieBackoffice({ salaireBaseUSD: 164, transportUSD: 0, enfants: 0 }, paramsNet);
    expect(l.remuneration100).toBeGreaterThan(164);
    expect(ct(l.salBrutUSD)).toBe(ct(l.remuneration100));
    expect(l.salNetUSD).toBe(164);
  });
});
