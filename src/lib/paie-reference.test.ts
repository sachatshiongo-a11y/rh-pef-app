import { describe, it, expect } from "vitest";
import { calculerPaieBrigade, type CodePresence, type ParametresPaie } from "@/lib/payroll";
import { calculerReferenceMois, type EntreesReference, type JourReference, type ResultatReference } from "./paie-reference";

// Paramètres = ceux de l'exercice 2026 en production (mêmes valeurs que payroll-reference.test.ts),
// salaires saisis en NET (interrupteur actif en production depuis 2026-07-22).
const PARAMS: ParametresPaie = {
  tauxChangeCDF: 2300, cnssSalarie: 0.05, cnssPatronalPensions: 0.05, cnssPatronalRisques: 0.015,
  cnssPatronalFamille: 0.065, plafondCnssMensuelCDF: null,
  iprTranchesAnnuellesCDF: [
    { ordre: 1, plafondAnnuelCDF: 1_944_000, taux: 0.03 },
    { ordre: 2, plafondAnnuelCDF: 21_600_000, taux: 0.15 },
    { ordre: 3, plafondAnnuelCDF: 43_200_000, taux: 0.3 },
    { ordre: 4, plafondAnnuelCDF: null, taux: 0.4 },
  ],
  iprPlancherMensuelCDF: 2000, iprPlafondTaux: 0.3, iprReductionFamilleTaux: 0.02, iprReductionFamilleMax: 9,
  iprBase: 2, inppTaux: 0.03, onemTaux: 0.002, hsSeuilHebdoH: 6, hsMajTranche1: 0.3, hsMajTranche2: 0.6,
  hsMajDimancheFerie: 1.0, allocFamilialeParEnfantUSD: 1.5, joursOuvrablesMois: 26, droitsCongesAnnuel: 18,
  salairesSaisisEnNet: true,
};

type Gabarit = {
  heures?: (d: Date) => number; // durée du créneau de TRAVAIL
  creneau?: (d: Date) => boolean; // créneau quelconque (système compris) ; défaut = heures > 0
  modele?: (d: Date) => number; // absent = salarié sans modèle (heuresModele null)
  code?: (d: Date) => CodePresence | null;
  faites?: (d: Date) => number;
  tauxRole?: (d: Date) => number | null;
};
function joursDuMois(annee: number, mois: number, g: Gabarit): JourReference[] {
  const n = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(annee, mois - 1, i + 1));
    const hp = g.heures?.(date) ?? 0;
    return {
      date,
      heuresPlanifiees: hp,
      aUnCreneau: g.creneau ? g.creneau(date) : hp > 0,
      heuresModele: g.modele ? g.modele(date) : null,
      code: g.code?.(date) ?? null,
      heuresFaites: g.faites?.(date) ?? 0,
      tauxRole: g.tauxRole?.(date) ?? null,
    };
  });
}
const jour = (d: Date) => d.getUTCDate();
const dow = (d: Date) => d.getUTCDay(); // 0 = dimanche
const lunSam = (d: Date) => dow(d) !== 0;

function entrees(e: Partial<EntreesReference> & Pick<EntreesReference, "jours" | "salaireMensuel" | "heuresHebdomadaires" | "heuresParJour">): EntreesReference {
  return {
    annee: 2026, mois: 9, dateEmbauche: new Date("2025-01-06T00:00:00Z"), joursFeries: new Set(),
    joursCongePris: 0, joursCongeSansSolde: [], referencePlanningDepuis: 202609, params: PARAMS, ...e,
  };
}
/** Base NETTE (avant reconstitution du brut) que le moteur va payer. */
const baseNette = (r: ResultatReference) =>
  r.moteur.salaireHoraire * r.moteur.heuresNormales +
  r.moteur.salaireJournalier * r.moteur.joursPayesNonTravailles +
  r.moteur.salaireJournalier * r.moteur.joursPayes2_3 * (2 / 3);
/** Net hors transport et hors allocation familiale, calculé par le VRAI moteur (brut reconstitué). */
const netSalaire = (r: ResultatReference, enfants: number) => {
  const l = calculerPaieBrigade({ ...r.moteur, transportMoisUSD: 0, enfants }, PARAMS);
  return l.salNetUSD - l.allocFamilialeUSD;
};

// ── Salariés réels, septembre 2026 (production, lecture seule) ─────────────────────────────────
const martine = () => {
  const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5) || jour(d) === 12 || jour(d) === 26 ? 9 : 0;
  return entrees({ salaireMensuel: 400, heuresHebdomadaires: 54, heuresParJour: 9,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null) }) });
};
const esther = () => {
  const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5) || jour(d) === 5 || jour(d) === 19 ? 9 : jour(d) === 12 || jour(d) === 26 ? 3.5 : 0;
  return entrees({ salaireMensuel: 300, heuresHebdomadaires: 51.92, heuresParJour: 9,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null) }) });
};
const rachel = () => {
  const h = (d: Date) => ([2, 4, 6].includes(dow(d)) ? 12 : 0);
  const f = (d: Date) => (h(d) > 0 || jour(d) === 28 || jour(d) === 30 ? 12 : 0); // 28 et 30 : hors planning
  return entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12,
    jours: joursDuMois(2026, 9, { heures: h, faites: f, code: (d) => (f(d) > 0 ? "P" : null) }) });
};
const syntyche = () => {
  const h = (d: Date) => (lunSam(d) && jour(d) <= 19 ? 6 : 0); // congé du 21 au 30, SANS créneau
  return entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 6,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (!lunSam(d) ? null : jour(d) <= 19 ? "P" : "C") }) });
};
const marie = () => {
  const h = (d: Date) => (lunSam(d) ? 8 : 0); // congé du 1er au 14 sur des créneaux de TRAVAIL laissés en place
  return entrees({ salaireMensuel: 200, heuresHebdomadaires: 48, heuresParJour: 8,
    jours: joursDuMois(2026, 9, { heures: h, faites: (d) => (jour(d) >= 15 ? h(d) : 0), code: (d) => (!lunSam(d) ? null : jour(d) <= 14 ? "C" : "P") }) });
};

describe("paie sur heures planifiées — salariés réels de septembre 2026", () => {
  it("Martine : 216 h planifiées toutes faites → 400,00 $ (au lieu de 369,23 $)", () => {
    const r = calculerReferenceMois(martine());
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(216);
    expect(r.tauxMois).toBeCloseTo(400 / 216, 10);
    expect(r.tauxContrat).toBeCloseTo(400 / 234, 10);
    expect(baseNette(r)).toBeCloseTo(400, 10);
    expect(netSalaire(r, 2)).toBeCloseTo(400, 2);
    const avant = calculerReferenceMois({ ...martine(), referencePlanningDepuis: null });
    expect(avant.source).toBe("CONTRAT");
    expect(baseNette(avant)).toBeCloseTo((216 * 400) / 234, 10); // 369,23 : le défaut mesuré
  });

  it("Esther : base 300,00 $, plus 2,08 h sup. imposées par son planning, au taux du CONTRAT", () => {
    const r = calculerReferenceMois(esther());
    expect(r.hs.hs30).toBeCloseTo(2.08, 10); // semaine du 14/09 : 54 h contre 51,92 h au contrat
    expect(r.heuresReference).toBe(220.92);
    expect(baseNette(r)).toBeCloseTo(300, 10);
    const t0 = 300 / (51.92 * 52 / 12);
    expect(r.moteur.hsValorisee).toBeCloseTo(2.08 * 1.3 * t0, 10);
    expect(netSalaire(r, 2)).toBeCloseTo(303.51, 2);
  });

  it("Rachel : 156 h planifiées, 180 h faites → les 24 h hors planning sont payées au taux du mois", () => {
    const r = calculerReferenceMois(rachel());
    expect(r.heuresReference).toBe(156);
    expect(r.moteur.heuresNormales).toBe(180);
    expect(baseNette(r)).toBeCloseTo((180 * 200) / 156, 10);
    expect(netSalaire(r, 0)).toBeCloseTo(230.77, 2);
  });

  it("Syntyche : congé hors planning entré dans la référence → 200,00 $, jamais 305,88 $", () => {
    const r = calculerReferenceMois(syntyche());
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(156); // 102 h planifiées + 9 j × 6 h de congé
    expect(r.affichage.joursPayesNonTravailles).toBe(9);
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(54);
    expect(r.affichage.indemniteCongesNet).toBeCloseTo((54 * 200) / 156, 10);
    expect(baseNette(r)).toBeCloseTo(200, 10);
    expect(baseNette(r)).not.toBeCloseTo(305.88, 1);
  });

  it("Marie : congé posé sur des créneaux de travail → payé une fois, 200,00 $", () => {
    const r = calculerReferenceMois(marie());
    expect(r.heuresReference).toBe(208);
    expect(r.affichage.joursPayesNonTravailles).toBe(12);
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(96);
    expect(baseNette(r)).toBeCloseTo(200, 10);
  });
});

// ── Propriétés (salarié type : 208 $, 48 h, 8 h du lundi au samedi → t = t0 = 1 $/h) ──────────
const type6j = (g: Partial<Gabarit> = {}, e: Partial<EntreesReference> = {}) => {
  const h = (d: Date) => (lunSam(d) ? 8 : 0);
  return entrees({ salaireMensuel: 208, heuresHebdomadaires: 48, heuresParJour: 8,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null), ...g }), ...e });
};

describe("paie sur heures planifiées — propriétés", () => {
  it("absence injustifiée un jour planifié → retenue de ses 8 h au taux du mois", () => {
    const r = calculerReferenceMois(type6j({ faites: (d) => (lunSam(d) && jour(d) !== 17 ? 8 : 0), code: (d) => (!lunSam(d) ? null : jour(d) === 17 ? "N" : "P") }));
    expect(baseNette(r)).toBeCloseTo(200, 10);
  });

  it("échange de jour (jeudi 17 manqué, samedi 19 non planifié travaillé) → neutre", () => {
    const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5 ? 8 : 0); // 5 j × 8 h = 40 h, sous le seuil de 48 h
    const f = (d: Date) => (jour(d) === 17 ? 0 : jour(d) === 19 ? 8 : h(d));
    const r = calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 48, heuresParJour: 8,
      jours: joursDuMois(2026, 9, { heures: h, faites: f, code: (d) => (f(d) > 0 ? "P" : jour(d) === 17 ? "N" : null) }) }));
    expect(r.heuresReference).toBe(176);
    expect(baseNette(r)).toBeCloseTo(200, 10);
  });

  it("mois entier en congé, créneaux de travail laissés → le salaire", () => {
    const r = calculerReferenceMois(type6j({ faites: () => 0, code: (d) => (lunSam(d) ? "C" : null) }));
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("mois entier en congé SANS aucun créneau → semaines couvertes, le salaire", () => {
    const r = calculerReferenceMois(type6j({ heures: () => 0, faites: () => 0, code: (d) => (lunSam(d) ? "C" : null) }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(208); // 26 j × heuresParJour (pas de modèle)
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("mois entier en absence injustifiée → 0", () => {
    const r = calculerReferenceMois(type6j({ faites: () => 0, code: (d) => (lunSam(d) ? "N" : null) }));
    expect(baseNette(r)).toBe(0);
  });

  it("une semaine sans créneau, en absence INJUSTIFIÉE → repli sur le contrat", () => {
    const r = calculerReferenceMois(type6j({
      heures: (d) => (lunSam(d) && (jour(d) < 21 || jour(d) > 27) ? 8 : 0),
      faites: (d) => (lunSam(d) && (jour(d) < 21 || jour(d) > 27) ? 8 : 0),
      code: (d) => (!lunSam(d) ? null : jour(d) >= 21 && jour(d) <= 27 ? "N" : "P"),
    }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Planning incomplet : semaine du 21/09 sans créneau");
    expect(r.avertissements).toEqual([{ code: "REPLI_CONTRAT", message: "Référence contrat (repli) — Planning incomplet : semaine du 21/09 sans créneau" }]);
    expect(r.heuresReference).toBe(208);
  });

  // ── Congé SANS SOLDE (S) : ses heures dues entrent dans R, rien dans la base (jamais payé) ──
  it("congé sans solde 2 jours SANS créneau → retenus : 192,00 (comme l'ancienne règle)", () => {
    const s = (d: Date) => jour(d) === 16 || jour(d) === 17;
    const h = (d: Date) => (lunSam(d) && !s(d) ? 8 : 0);
    const r = calculerReferenceMois(type6j({ heures: h, faites: h, code: (d) => (!lunSam(d) ? null : s(d) ? "S" : "P") }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBeCloseTo(192, 10);
    const avant = calculerReferenceMois({ ...type6j({ heures: h, faites: h, code: (d) => (!lunSam(d) ? null : s(d) ? "S" : "P") }), referencePlanningDepuis: null });
    expect(baseNette(avant)).toBeCloseTo(192, 10);
  });

  it("semaine entière en congé sans solde sur des créneaux système « Congé » → 160,00", () => {
    const s = (d: Date) => jour(d) >= 21 && jour(d) <= 26;
    const h = (d: Date) => (lunSam(d) && !s(d) ? 8 : 0);
    const r = calculerReferenceMois(type6j({ heures: h, creneau: lunSam, faites: h, code: (d) => (!lunSam(d) ? null : s(d) ? "S" : "P") }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBeCloseTo(160, 10);
  });

  it("semaine entière en congé sans solde SANS aucun créneau → semaine couverte, 160,00", () => {
    const s = (d: Date) => jour(d) >= 21 && jour(d) <= 27;
    const h = (d: Date) => (lunSam(d) && !s(d) ? 8 : 0);
    const r = calculerReferenceMois(type6j({ heures: h, faites: h, code: (d) => (!lunSam(d) ? null : s(d) ? "S" : "P") }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBeCloseTo(160, 10);
  });

  it("Martine, 2 jours de congé sans solde (9 h) sans créneau → 366,67 $, jamais 400,00 $", () => {
    const m = martine();
    const s = (d: Date) => jour(d) === 16 || jour(d) === 17;
    const r = calculerReferenceMois({ ...m, jours: m.jours.map((j) => (s(j.date) ? { ...j, heuresPlanifiees: 0, aUnCreneau: false, heuresFaites: 0, code: "S" as const } : j)) });
    expect(r.heuresReference).toBe(216);
    expect(baseNette(r)).toBeCloseTo((198 * 400) / 216, 10);
    expect(netSalaire(r, 2)).toBeCloseTo(366.67, 2);
  });

  // ── Plafond hebdomadaire des heures dues sans créneau : max(0, H − heures planifiées de la semaine) ──
  it("Rachel (36 h/sem, 12 h/j, sans modèle), semaine S sans créneau → retenue plafonnée à 36 h : 153,85", () => {
    const s = (d: Date) => jour(d) >= 14 && jour(d) <= 20;
    const h = (d: Date) => ([2, 4, 6].includes(dow(d)) && !s(d) ? 12 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12,
      jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (s(d) && lunSam(d) ? "S" : h(d) > 0 ? "P" : null) }) }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(156); // 120 h planifiées + 36 h retenues (et non 72)
    expect(baseNette(r)).toBeCloseTo((120 * 200) / 156, 10); // 153,85, jamais 125,00
  });

  it("40 h/sem, 8 h/j du lundi au vendredi, sans modèle, semaine S sans créneau → 160,73", () => {
    const s = (d: Date) => jour(d) >= 14 && jour(d) <= 20;
    const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5 && !s(d) ? 8 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 208, heuresHebdomadaires: 40, heuresParJour: 8,
      jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (s(d) && lunSam(d) ? "S" : h(d) > 0 ? "P" : null) }) }));
    expect(r.heuresReference).toBe(176);
    expect(baseNette(r)).toBeCloseTo((136 * 208) / 176, 10); // 160,73, jamais 153,74
  });

  it("Rachel, mardi 15 travaillé puis S du 16 au 19 sans créneau → plafond = 36 − 12 h : 169,23", () => {
    const s = (d: Date) => jour(d) >= 16 && jour(d) <= 19;
    const h = (d: Date) => ([2, 4, 6].includes(dow(d)) && !s(d) ? 12 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12,
      jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (s(d) ? "S" : h(d) > 0 ? "P" : null) }) }));
    expect(r.heuresReference).toBe(156); // 132 h planifiées + 24 h retenues (mer., jeu.)
    expect(baseNette(r)).toBeCloseTo((132 * 200) / 156, 10);
  });

  it("Rachel, semaine de congé PAYÉ sans créneau → plafond neutre : 200,00", () => {
    const c = (d: Date) => jour(d) >= 14 && jour(d) <= 20;
    const h = (d: Date) => ([2, 4, 6].includes(dow(d)) && !c(d) ? 12 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12,
      jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (c(d) && lunSam(d) ? "C" : h(d) > 0 ? "P" : null) }) }));
    expect(r.heuresReference).toBe(156);
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(36);
    expect(baseNette(r)).toBeCloseTo(200, 10);
  });

  // ── Prorata : l'argent ne dépend jamais de l'ordre des codes dans la semaine ──
  it("Rachel, C lun-mer + S jeu-sam, ou S puis C, sans créneau → 176,92 dans les deux ordres", () => {
    const semaine = (d: Date) => jour(d) >= 14 && jour(d) <= 19;
    const h = (d: Date) => ([2, 4, 6].includes(dow(d)) && !(jour(d) >= 14 && jour(d) <= 20) ? 12 : 0);
    const rachelMixte = (avant: CodePresence, apres: CodePresence) => calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12,
      jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (semaine(d) ? (jour(d) <= 16 ? avant : apres) : h(d) > 0 ? "P" : null) }) }));
    for (const r of [rachelMixte("C", "S"), rachelMixte("S", "C")]) {
      expect(r.heuresReference).toBe(156); // 120 h planifiées + 36 h (18 payées, 18 retenues)
      expect(r.affichage.heuresPayeesNonTravaillees).toBeCloseTo(18, 10);
      expect(baseNette(r)).toBeCloseTo((138 * 200) / 156, 10);
    }
  });

  it("Rachel, semaine S avec un férié SANS code et hors congé → le férié consomme le plafond : 161,54", () => {
    const s = (d: Date) => jour(d) >= 14 && jour(d) <= 20;
    const h = (d: Date) => ([2, 4, 6].includes(dow(d)) && !s(d) ? 12 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12, joursFeries: new Set(["2026-09-15"]),
      jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (s(d) && lunSam(d) && jour(d) !== 15 ? "S" : h(d) > 0 ? "P" : null) }) }));
    expect(r.heuresReference).toBe(156); // 120 h + 36 h réparties sur 6 jours (et non 120 + 12 + 36)
    expect(baseNette(r)).toBeCloseTo((126 * 200) / 156, 10); // 161,54, jamais 157,14
  });

  it("Rachel, S du lundi 28 au mercredi 30 (semaine tronquée) → plafond 36 × 3/6 = 18 h : 177,78", () => {
    const s = (d: Date) => jour(d) >= 28;
    const h = (d: Date) => ([2, 4, 6].includes(dow(d)) && !s(d) ? 12 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12,
      jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (s(d) ? "S" : h(d) > 0 ? "P" : null) }) }));
    expect(r.heuresReference).toBe(162); // 144 h + 18 h (et non 36)
    expect(baseNette(r)).toBeCloseTo((144 * 200) / 162, 10); // 177,78, jamais 160,00
  });

  // ── Férié dans un congé sans solde APPROUVÉ : arrive SANS code (conges-presences saute les fériés) ──
  it("semaine de congé sans solde, férié sans code mais couvert par le congé → 160,00", () => {
    const s = (d: Date) => jour(d) >= 14 && jour(d) <= 19;
    const h = (d: Date) => (lunSam(d) && !s(d) ? 8 : 0);
    const r = calculerReferenceMois(type6j({ heures: h, faites: h, code: (d) => (!lunSam(d) ? null : jour(d) === 15 ? null : s(d) ? "S" : "P") },
      { joursFeries: new Set(["2026-09-15"]), joursCongeSansSolde: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"] }));
    expect(r.heuresReference).toBe(208);
    expect(r.affichage.joursPayesNonTravailles).toBe(0);
    expect(baseNette(r)).toBeCloseTo(160, 10);
  });

  it("mois entier en congé sans solde, férié sans code mais couvert par le congé → 0,00", () => {
    const tous = joursDuMois(2026, 9, {}).map((j) => j.date.toISOString().slice(0, 10));
    const r = calculerReferenceMois(type6j({ heures: () => 0, faites: () => 0, code: (d) => (lunSam(d) && jour(d) !== 15 ? "S" : null) },
      { joursFeries: new Set(["2026-09-15"]), joursCongeSansSolde: tous }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBe(0);
  });

  // ── Congé sans solde un jour férié : contrat suspendu, rien n'est dû ──
  it("mois entier en congé sans solde avec un férié → 0,00", () => {
    const r = calculerReferenceMois(type6j({ heures: () => 0, faites: () => 0, code: (d) => (lunSam(d) ? "S" : null) }, { joursFeries: new Set(["2026-09-15"]) }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBe(0);
  });

  it("semaine de congé sans solde contenant un férié → 160,00 (le férié n'est pas payé)", () => {
    const s = (d: Date) => jour(d) >= 14 && jour(d) <= 19;
    const h = (d: Date) => (lunSam(d) && !s(d) ? 8 : 0);
    const r = calculerReferenceMois(type6j({ heures: h, faites: h, code: (d) => (!lunSam(d) ? null : s(d) ? "S" : "P") }, { joursFeries: new Set(["2026-09-15"]) }));
    expect(r.heuresReference).toBe(208);
    expect(r.affichage.joursPayesNonTravailles).toBe(0);
    expect(baseNette(r)).toBeCloseTo(160, 10);
  });

  it("jour payé sur un jour de repos du modèle (hdu = 0) → ni jour ni heure payés en plus", () => {
    const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5 && (jour(d) < 14 || jour(d) > 19) ? 8 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 176, heuresHebdomadaires: 48, heuresParJour: 8,
      jours: joursDuMois(2026, 9, { heures: h, modele: (d) => (dow(d) >= 1 && dow(d) <= 5 ? 8 : 0), faites: h,
        code: (d) => (!lunSam(d) ? null : jour(d) >= 14 && jour(d) <= 19 ? "C" : h(d) > 0 ? "P" : null) }) }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(176);
    expect(r.affichage.joursPayesNonTravailles).toBe(5); // le samedi 19 (0 h au modèle) ne compte pas
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(40);
    expect(baseNette(r)).toBeCloseTo(176, 10);
  });

  it("maladie deux jours planifiés → payés aux deux tiers", () => {
    const r = calculerReferenceMois(type6j({ faites: (d) => (lunSam(d) && jour(d) !== 16 && jour(d) !== 17 ? 8 : 0), code: (d) => (!lunSam(d) ? null : jour(d) === 16 || jour(d) === 17 ? "M" : "P") }));
    expect(baseNette(r)).toBeCloseTo(192 + (16 * 2) / 3, 10);
  });

  it("absence un jour NON planifié → sans effet", () => {
    const r = calculerReferenceMois(type6j({ heures: (d) => (dow(d) >= 1 && dow(d) <= 5 ? 8 : 0), faites: (d) => (dow(d) >= 1 && dow(d) <= 5 ? 8 : 0), code: (d) => (dow(d) === 6 ? "N" : dow(d) === 0 ? null : "P") }));
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("mois d'embauche → repli, motif daté", () => {
    const r = calculerReferenceMois(type6j({}, { dateEmbauche: new Date("2026-09-15T00:00:00Z") }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Embauche le 15/09/2026 : mois incomplet");
  });

  it("mois de fin de contrat → repli, motif daté", () => {
    const r = calculerReferenceMois(type6j({}, { dateFinContrat: new Date("2026-09-28T00:00:00Z") }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Fin de contrat le 28/09/2026 : mois incomplet");
    expect(r.avertissements).toEqual([{ code: "REPLI_CONTRAT", message: "Référence contrat (repli) — Fin de contrat le 28/09/2026 : mois incomplet" }]);
  });

  it("contrat qui finit le dernier jour du mois, ou plus tard → pas de repli", () => {
    expect(calculerReferenceMois(type6j({}, { dateFinContrat: new Date("2026-09-30T00:00:00Z") })).source).toBe("PLANNING");
    expect(calculerReferenceMois(type6j({}, { dateFinContrat: new Date("2027-03-31T00:00:00Z") })).source).toBe("PLANNING");
    expect(calculerReferenceMois(type6j({}, { dateFinContrat: null })).source).toBe("PLANNING");
  });

  it("contrat terminé AVANT le mois calculé → date ignorée, pas de repli trompeur", () => {
    const r = calculerReferenceMois(type6j({}, { dateFinContrat: new Date("2026-08-31T00:00:00Z") }));
    expect(r.source).toBe("PLANNING");
    expect(r.motif).toBeNull();
  });

  it("heures hebdomadaires du contrat non renseignées → repli, motif juste", () => {
    const r = calculerReferenceMois(type6j({}, { heuresHebdomadaires: 0 }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Heures hebdomadaires du contrat non renseignées");
  });

  it("avant la date d'effet (août 2026) ou sans date d'effet → ancienne règle, sans avertissement", () => {
    const aout = calculerReferenceMois({ ...type6j(), mois: 8, jours: joursDuMois(2026, 8, { heures: (d) => (lunSam(d) ? 8 : 0), faites: (d) => (lunSam(d) ? 8 : 0), code: (d) => (lunSam(d) ? "P" : null) }) });
    expect(aout.source).toBe("CONTRAT");
    expect(aout.avertissements).toEqual([]);
    expect(calculerReferenceMois(type6j({}, { referencePlanningDepuis: null })).source).toBe("CONTRAT");
  });

  it("semaine réduite à un dimanche (novembre 2026 commence un dimanche) → pas de repli", () => {
    const r = calculerReferenceMois({ ...type6j(), mois: 11, jours: joursDuMois(2026, 11, { heures: (d) => (lunSam(d) ? 8 : 0), faites: (d) => (lunSam(d) ? 8 : 0), code: (d) => (lunSam(d) ? "P" : null) }) });
    expect(r.source).toBe("PLANNING");
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("uniquement des créneaux Repos → repli « Aucune heure planifiée ce mois »", () => {
    const r = calculerReferenceMois(type6j({ heures: () => 0, creneau: (d) => lunSam(d), faites: () => 0, code: () => null }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Aucune heure planifiée ce mois");
  });
});

describe("paie sur heures planifiées — fériés et dimanches (règle B1 : double, jamais triple)", () => {
  const FERIE = new Set(["2026-09-15"]); // mardi (férié fictif pour le test)
  it("férié dû non travaillé, NON codé F, créneau système Férié → payé par le forfait : le salaire", () => {
    const r = calculerReferenceMois(type6j({
      heures: (d) => (lunSam(d) && jour(d) !== 15 ? 8 : 0), creneau: (d) => lunSam(d), modele: (d) => (lunSam(d) ? 8 : 0),
      faites: (d) => (lunSam(d) && jour(d) !== 15 ? 8 : 0), code: (d) => (lunSam(d) && jour(d) !== 15 ? "P" : null),
    }, { joursFeries: FERIE }));
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.moteur.hsValorisee).toBe(0);
  });
  it("férié dû travaillé 8 h → le salaire + la prime seule (8 × 1 × t0)", () => {
    const r = calculerReferenceMois(type6j({}, { joursFeries: FERIE }));
    expect(r.hs.hs100).toBe(8);
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.moteur.hsValorisee).toBeCloseTo(8, 10);
  });
  it("férié un jour de repos du modèle, travaillé 8 h → base + prime (16)", () => {
    const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5 && jour(d) !== 15 ? 8 : 0);
    const f = (d: Date) => (h(d) > 0 || jour(d) === 15 ? 8 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 176, heuresHebdomadaires: 48, heuresParJour: 8, joursFeries: new Set(["2026-09-15"]),
      jours: joursDuMois(2026, 9, { heures: h, creneau: (d) => h(d) > 0 || jour(d) === 15, modele: (d) => (dow(d) >= 1 && dow(d) <= 5 && jour(d) !== 15 ? 8 : 0), faites: f, code: (d) => (f(d) > 0 ? "P" : null) }) }));
    expect(r.heuresReference).toBe(168);
    expect(baseNette(r)).toBeCloseTo(176, 10);
    expect(r.moteur.hsValorisee).toBeCloseTo(16 * (176 / (48 * 52 / 12)), 10);
  });
  it("dimanche travaillé hors planning → base + prime au taux du contrat, référence inchangée", () => {
    const r = calculerReferenceMois(type6j({ faites: (d) => (lunSam(d) || jour(d) === 20 ? 8 : 0), code: (d) => (lunSam(d) || jour(d) === 20 ? "P" : null) }));
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.moteur.hsValorisee).toBeCloseTo(16, 10);
  });
});

describe("paie sur heures planifiées — avertissements", () => {
  it("taux de rôle sur un créneau → ignoré et signalé", () => {
    const r = calculerReferenceMois(type6j({ tauxRole: (d) => (jour(d) === 3 ? 5 : null) }));
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.avertissements).toEqual([{ code: "TAUX_ROLE_IGNORE", message: "Taux de rôle ignoré (paie sur le planning) : 03/09" }]);
  });
  it("planning très inférieur au contrat (t > 1,3 × t0) → signalé", () => {
    const h = (d: Date) => ([1, 3, 5].includes(dow(d)) ? 8 : 0); // 13 j × 8 h = 104 h → t = 2
    const r = calculerReferenceMois(type6j({ heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null) }));
    expect(r.tauxMois).toBeCloseTo(2, 10);
    expect(r.avertissements.map((a) => a.code)).toEqual(["TAUX_MOIS_SUPERIEUR_HS"]);
    expect(r.avertissements[0].message).toBe("Taux du mois 2,0000 $/h au-dessus d'une heure supplémentaire à +30 % (1,3000 $/h) : planning très inférieur au contrat");
  });
});

describe("ancienne règle (mode contrat) — reproduite à l'identique", () => {
  it("taux de rôle pondéré, jours payés à la journée, heures contrat arrondies", () => {
    const r = calculerReferenceMois(type6j({ tauxRole: (d) => (jour(d) === 3 ? 2 : null), faites: (d) => (lunSam(d) && jour(d) !== 4 ? 8 : 0), code: (d) => (!lunSam(d) ? null : jour(d) === 4 ? "O" : "P") }, { referencePlanningDepuis: null, joursCongePris: 0 }));
    expect(r.source).toBe("CONTRAT");
    expect(r.heuresReference).toBe(208);
    expect(r.moteur.salaireHoraire).toBeCloseTo((192 * 1 + 8 * 2) / 200, 10);
    expect(r.moteur.salaireJournalier).toBeCloseTo(8 * ((192 + 16) / 200), 10);
    expect(r.moteur.joursPayesNonTravailles).toBe(1);
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(8);
  });
});
