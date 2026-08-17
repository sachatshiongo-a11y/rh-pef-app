import { describe, expect, it } from "vitest";
import { calculerEcarts, issueCreneau, type EntreesEcart } from "@/lib/planning-ecart";

const d = (dateIso: string) => new Date(dateIso + "T00:00:00.000Z");

const SHIFT_MATIN = { id: "sh-matin", nom: "Matin cuisine", dureeHeures: 8 };

/** Entrées minimales : semaine du 6 au 12 juillet 2026, tout vide sauf les employés fournis. */
function entreesBase(surcharge: Partial<EntreesEcart> = {}): EntreesEcart {
  return {
    debut: d("2026-07-06"),
    fin: d("2026-07-12"),
    employes: [{ id: "e1", nom: "Employé 1", poste: "Cuisinier" }],
    shifts: [SHIFT_MATIN],
    creneaux: [],
    codes: [],
    heures: [],
    ...surcharge,
  };
}

describe("issueCreneau", () => {
  it("un code P est TENU", () => {
    expect(issueCreneau("P")).toBe("TENU");
  });
  it("l'absence de code (null ou undefined) est NON_RENSEIGNE, jamais ABSENT", () => {
    expect(issueCreneau(null)).toBe("NON_RENSEIGNE");
    expect(issueCreneau(undefined)).toBe("NON_RENSEIGNE");
  });
  it("tout autre code est ABSENT", () => {
    for (const code of ["M", "A", "C", "N", "S", "O", "F"]) {
      expect(issueCreneau(code), code).toBe("ABSENT");
    }
  });
});

describe("calculerEcarts — un créneau codé P est tenu ; les autres codes sont absents avec leur raison", () => {
  it("regroupe la couverture d'un jour/shift/poste et donne la raison exacte de chaque absence", () => {
    const employes = [
      { id: "e-p", nom: "Présent", poste: "Cuisinier" },
      { id: "e-m", nom: "Malade", poste: "Cuisinier" },
      { id: "e-a", nom: "Absent justifié", poste: "Cuisinier" },
      { id: "e-c", nom: "En congé", poste: "Cuisinier" },
      { id: "e-n", nom: "Absent injustifié", poste: "Cuisinier" },
      { id: "e-s", nom: "Sans solde", poste: "Cuisinier" },
    ];
    const jour = d("2026-07-06");
    const r = calculerEcarts(entreesBase({
      employes,
      creneaux: employes.map((e) => ({ employeeId: e.id, date: jour, shiftId: SHIFT_MATIN.id })),
      codes: [
        { employeeId: "e-p", date: jour, code: "P" },
        { employeeId: "e-m", date: jour, code: "M" },
        { employeeId: "e-a", date: jour, code: "A" },
        { employeeId: "e-c", date: jour, code: "C" },
        { employeeId: "e-n", date: jour, code: "N" },
        { employeeId: "e-s", date: jour, code: "S" },
      ],
    }));

    expect(r.couverture).toHaveLength(1);
    const ligne = r.couverture[0];
    expect(ligne.prevus).toBe(6);
    expect(ligne.tenus).toBe(1);
    expect([...ligne.manquants].sort((a, b) => a.employeeId.localeCompare(b.employeeId))).toEqual([
      { employeeId: "e-a", code: "A" },
      { employeeId: "e-c", code: "C" },
      { employeeId: "e-m", code: "M" },
      { employeeId: "e-n", code: "N" },
      { employeeId: "e-s", code: "S" },
    ]);
    expect(r.total).toEqual({
      creneauxPrevus: 6,
      creneauxTenus: 1,
      creneauxAbsents: 5,
      creneauxNonRenseignes: 0,
      heuresPlanifiees: 48,
      heuresRealisees: 0, // aucune heure saisie ici, ce n'est pas l'objet de ce test
    });
  });
});

describe("calculerEcarts — un créneau sans code n'est pas une absence", () => {
  it("classe le créneau en NON_RENSEIGNE, avec un code null, jamais dans les absents", () => {
    const jour = d("2026-07-06");
    const r = calculerEcarts(entreesBase({
      creneaux: [{ employeeId: "e1", date: jour, shiftId: SHIFT_MATIN.id }],
      codes: [], // rien de saisi
    }));

    expect(r.couverture).toHaveLength(1);
    expect(r.couverture[0].tenus).toBe(0);
    expect(r.couverture[0].manquants).toEqual([{ employeeId: "e1", code: null }]);
    expect(r.total.creneauxNonRenseignes).toBe(1);
    expect(r.total.creneauxAbsents).toBe(0); // le point qui doit rester à zéro : pas une négligence du salarié
  });
});

describe("calculerEcarts — travail hors planning", () => {
  it("un jour travaillé sans créneau prévu compte en écart positif et ne couvre jamais de besoin", () => {
    const lundi = d("2026-07-06");
    const dimancheHorsPlan = d("2026-07-12");
    const r = calculerEcarts(entreesBase({
      creneaux: [{ employeeId: "e1", date: lundi, shiftId: SHIFT_MATIN.id }],
      codes: [
        { employeeId: "e1", date: lundi, code: "P" },
        { employeeId: "e1", date: dimancheHorsPlan, code: "P" },
      ],
      heures: [
        { employeeId: "e1", date: lundi, heuresTravaillees: 8 },
        { employeeId: "e1", date: dimancheHorsPlan, heuresTravaillees: 6 },
      ],
    }));

    const ligne = r.heures[0];
    expect(ligne.joursPlanifies).toBe(1); // le dimanche n'était PAS planifié
    expect(ligne.joursTravaillesHorsPlanning).toBe(1);
    expect(ligne.heuresPlanifiees).toBe(8);
    expect(ligne.heuresRealisees).toBe(14); // 8 (planifié, tenu) + 6 (hors planning)
    expect(ligne.ecart).toBe(6);

    // Un seul groupe de couverture, celui du lundi planifié — le dimanche hors planning n'en crée
    // aucun, il ne peut donc jamais compter comme un besoin couvert.
    expect(r.couverture).toHaveLength(1);
    expect(r.couverture[0].date).toEqual(lundi);
    expect(r.total.creneauxPrevus).toBe(1);
  });
});

describe("calculerEcarts — jour P sans heures", () => {
  it("compte 0 heure réalisée pour ce jour et le signale à part", () => {
    const jour = d("2026-07-06");
    const r = calculerEcarts(entreesBase({
      creneaux: [{ employeeId: "e1", date: jour, shiftId: SHIFT_MATIN.id }],
      codes: [{ employeeId: "e1", date: jour, code: "P" }],
      heures: [], // rien de saisi malgré la présence
    }));

    const ligne = r.heures[0];
    expect(ligne.joursTenus).toBe(1); // le créneau est bien tenu : le code est P
    expect(ligne.heuresRealisees).toBe(0);
    expect(ligne.joursPresenceSansHeures).toBe(1);
    expect(ligne.ecart).toBe(-8);
  });

  it("ne signale rien quand le jour P a bien ses heures", () => {
    const jour = d("2026-07-06");
    const r = calculerEcarts(entreesBase({
      creneaux: [{ employeeId: "e1", date: jour, shiftId: SHIFT_MATIN.id }],
      codes: [{ employeeId: "e1", date: jour, code: "P" }],
      heures: [{ employeeId: "e1", date: jour, heuresTravaillees: 8 }],
    }));
    expect(r.heures[0].joursPresenceSansHeures).toBe(0);
    expect(r.heures[0].heuresRealisees).toBe(8);
  });
});

describe("calculerEcarts — heures planifiées suivent la durée réelle des shifts", () => {
  it("ne applique jamais un forfait : deux shifts de durées différentes donnent des totaux différents", () => {
    const shiftCourt = { id: "sh-court", nom: "Service court", dureeHeures: 4 };
    const shiftLong = { id: "sh-long", nom: "Service long", dureeHeures: 11 };
    const lundi = d("2026-07-06");
    const mardi = d("2026-07-07");
    const r = calculerEcarts(entreesBase({
      shifts: [shiftCourt, shiftLong],
      creneaux: [
        { employeeId: "e1", date: lundi, shiftId: shiftCourt.id },
        { employeeId: "e1", date: mardi, shiftId: shiftLong.id },
      ],
    }));

    expect(r.heures[0].heuresPlanifiees).toBe(15); // 4 + 11, jamais 2 × 8
  });
});

describe("calculerEcarts — période à cheval sur deux mois", () => {
  it("traite les deux mois sans perte, y compris de part et d'autre de la frontière", () => {
    const finJuillet = d("2026-07-30");
    const debutAout = d("2026-08-02");
    const r = calculerEcarts(entreesBase({
      debut: finJuillet,
      fin: debutAout,
      creneaux: [
        { employeeId: "e1", date: d("2026-07-30"), shiftId: SHIFT_MATIN.id }, // juillet
        { employeeId: "e1", date: d("2026-07-31"), shiftId: SHIFT_MATIN.id }, // juillet, dernier jour
        { employeeId: "e1", date: d("2026-08-01"), shiftId: SHIFT_MATIN.id }, // août, premier jour
        { employeeId: "e1", date: d("2026-08-02"), shiftId: SHIFT_MATIN.id }, // août
      ],
      codes: [
        { employeeId: "e1", date: d("2026-07-30"), code: "P" },
        { employeeId: "e1", date: d("2026-07-31"), code: "P" },
        { employeeId: "e1", date: d("2026-08-01"), code: "P" },
        { employeeId: "e1", date: d("2026-08-02"), code: "P" },
      ],
      heures: [
        { employeeId: "e1", date: d("2026-07-30"), heuresTravaillees: 8 },
        { employeeId: "e1", date: d("2026-07-31"), heuresTravaillees: 8 },
        { employeeId: "e1", date: d("2026-08-01"), heuresTravaillees: 8 },
        { employeeId: "e1", date: d("2026-08-02"), heuresTravaillees: 8 },
      ],
    }));

    expect(r.total.creneauxPrevus).toBe(4);
    expect(r.total.creneauxTenus).toBe(4);
    expect(r.heures[0].heuresPlanifiees).toBe(32);
    expect(r.heures[0].heuresRealisees).toBe(32);
    expect(r.heures[0].joursPlanifies).toBe(4);
  });

  it("ignore les données hors de [debut, fin], même pour un employé par ailleurs dans la période", () => {
    const r = calculerEcarts(entreesBase({
      debut: d("2026-07-30"),
      fin: d("2026-08-02"),
      creneaux: [
        { employeeId: "e1", date: d("2026-07-29"), shiftId: SHIFT_MATIN.id }, // avant la période
        { employeeId: "e1", date: d("2026-08-03"), shiftId: SHIFT_MATIN.id }, // après la période
        { employeeId: "e1", date: d("2026-08-01"), shiftId: SHIFT_MATIN.id }, // dans la période
      ],
    }));
    expect(r.total.creneauxPrevus).toBe(1);
    expect(r.heures[0].joursPlanifies).toBe(1);
  });
});
