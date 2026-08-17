import { describe, expect, it } from "vitest";
import {
  grouperSalaries,
  pivoterParShift,
  type BesoinPeriode,
  type CreneauPeriode,
  type JourPeriode,
  type SalarieAClasser,
  type SalarieAffecte,
} from "./lecture-shift";

// Semaine réelle du 17 (lundi) au 23 (dimanche) août 2026 — dow = Date#getUTCDay() (0 = dimanche).
const SEMAINE: JourPeriode[] = [
  { iso: "2026-08-17", dow: 1 }, // lundi
  { iso: "2026-08-18", dow: 2 }, // mardi
  { iso: "2026-08-19", dow: 3 }, // mercredi
  { iso: "2026-08-20", dow: 4 }, // jeudi
  { iso: "2026-08-21", dow: 5 }, // vendredi
  { iso: "2026-08-22", dow: 6 }, // samedi
  { iso: "2026-08-23", dow: 0 }, // dimanche
];

function employe(id: string, nom: string, poste: string, categorie: "BRIGADE" | "BACKOFFICE" = "BRIGADE"): SalarieAClasser {
  return { id, nom, heuresHebdo: 45, categorie, poste };
}

describe("grouperSalaries", () => {
  it("critère « categorie » : deux blocs Brigade/Backoffice, triés par nom, effectif juste", () => {
    const employees = [
      employe("e1", "Zoé", "Cuisine", "BRIGADE"),
      employe("e2", "Alice", "Cuisine", "BRIGADE"),
      employe("e3", "Marc", "Compta", "BACKOFFICE"),
    ];
    const groupes = grouperSalaries(employees, "categorie");
    expect(groupes).toEqual([
      { titre: "Brigade", employees: [employe("e2", "Alice", "Cuisine", "BRIGADE"), employe("e1", "Zoé", "Cuisine", "BRIGADE")] },
      { titre: "Backoffice", employees: [employe("e3", "Marc", "Compta", "BACKOFFICE")] },
    ]);
  });

  it("critère « categorie » : un bloc vide reste présent (pas de Backoffice → bloc vide, pas absent)", () => {
    const groupes = grouperSalaries([employe("e1", "Alice", "Cuisine", "BRIGADE")], "categorie");
    expect(groupes).toHaveLength(2);
    expect(groupes[1]).toEqual({ titre: "Backoffice", employees: [] });
  });

  it("critère « poste » : un bloc par poste, triés alphabétiquement, employés triés par nom dans chaque bloc", () => {
    const employees = [
      employe("e1", "Marc", "Salle"),
      employe("e2", "Zoé", "Cuisine"),
      employe("e3", "Alice", "Cuisine"),
    ];
    const groupes = grouperSalaries(employees, "poste");
    expect(groupes.map((g) => g.titre)).toEqual(["Cuisine", "Salle"]);
    expect(groupes[0].employees.map((e) => e.nom)).toEqual(["Alice", "Zoé"]);
    expect(groupes[1].employees.map((e) => e.nom)).toEqual(["Marc"]);
  });

  it("critère « poste » : un salarié sans poste renseigné va dans un bloc « Sans poste » explicite, placé en dernier, jamais omis", () => {
    const employees = [
      employe("e1", "Alice", "Cuisine"),
      employe("e2", "Bruno", ""), // poste vide
      employe("e3", "Chris", "   "), // poste blanc
    ];
    const groupes = grouperSalaries(employees, "poste");
    expect(groupes.map((g) => g.titre)).toEqual(["Cuisine", "Sans poste"]);
    const sansPoste = groupes[groupes.length - 1];
    expect(sansPoste.titre).toBe("Sans poste");
    expect(sansPoste.employees.map((e) => e.id).sort()).toEqual(["e2", "e3"]);
    // Personne perdu : la somme des effectifs des blocs égale l'effectif de départ.
    expect(groupes.reduce((n, g) => n + g.employees.length, 0)).toBe(employees.length);
  });

  it("critère « aucun » : une seule liste triée par nom, tout le monde dedans", () => {
    const employees = [
      employe("e1", "Zoé", "Cuisine"),
      employe("e2", "Alice", "Compta", "BACKOFFICE"),
      employe("e3", "Marc", "Salle"),
    ];
    const groupes = grouperSalaries(employees, "aucun");
    expect(groupes).toHaveLength(1);
    expect(groupes[0].employees.map((e) => e.nom)).toEqual(["Alice", "Marc", "Zoé"]);
    expect(groupes[0].employees).toHaveLength(3);
  });
});

describe("pivoterParShift", () => {
  const SHIFTS = [{ id: "matin" }, { id: "soir" }]; // ordre d'affichage

  const EMPLOYEES: SalarieAffecte[] = [
    { id: "e-alice", nom: "Alice", poste: "Cuisine" },
    { id: "e-marc", nom: "Marc", poste: "Salle" },
    { id: "e-theo", nom: "Théo", poste: "" }, // sans poste renseigné
    { id: "e-conge", nom: "En congé", poste: "Cuisine" },
  ];

  it("un shift avec des affectations mais aucun besoin déclaré produit quand même une ligne, avec requis null partout", () => {
    const creneaux: CreneauPeriode[] = [{ employeeId: "e-marc", iso: "2026-08-19", shiftId: "soir" }]; // mercredi
    const lignes = pivoterParShift({ jours: SEMAINE, creneaux, employees: EMPLOYEES, besoins: [], absences: [], shifts: SHIFTS });

    expect(lignes).toHaveLength(1);
    const [ligne] = lignes;
    expect(ligne.shiftId).toBe("soir");
    expect(ligne.poste).toBe("Salle");
    expect(ligne.jours).toHaveLength(7);
    // Case du mercredi : Marc, pas de besoin déclaré.
    expect(ligne.jours[2]).toEqual({ iso: "2026-08-19", personnes: [{ id: "e-marc", nom: "Marc" }], requis: null });
    // Tous les autres jours : case vide, ligne quand même présente (pas de ligne manquante).
    for (const i of [0, 1, 3, 4, 5, 6]) {
      expect(ligne.jours[i]).toEqual({ iso: SEMAINE[i].iso, personnes: [], requis: null });
    }
  });

  it("un besoin déclaré que personne ne tient produit une ligne avec des cases vides et le requis exact", () => {
    const besoins: BesoinPeriode[] = [{ shiftId: "matin", poste: "Cuisine", jourSemaine: 1, nombreRequis: 2 }]; // lundi
    const lignes = pivoterParShift({ jours: SEMAINE, creneaux: [], employees: EMPLOYEES, besoins, absences: [], shifts: SHIFTS });

    expect(lignes).toHaveLength(1);
    const [ligne] = lignes;
    expect(ligne.shiftId).toBe("matin");
    expect(ligne.poste).toBe("Cuisine");
    // Lundi : requis 2, personne ne le tient → 0/2.
    expect(ligne.jours[0]).toEqual({ iso: "2026-08-17", personnes: [], requis: 2 });
    // Les autres jours n'ont pas de besoin déclaré → requis null, case vide.
    for (const i of [1, 2, 3, 4, 5, 6]) {
      expect(ligne.jours[i]).toEqual({ iso: SEMAINE[i].iso, personnes: [], requis: null });
    }
  });

  it("une personne en congé approuvé n'apparaît dans aucune case, même quand un collègue tient le même shift × poste ce jour-là", () => {
    const besoins: BesoinPeriode[] = [{ shiftId: "matin", poste: "Cuisine", jourSemaine: 1, nombreRequis: 2 }]; // lundi
    const creneaux: CreneauPeriode[] = [
      { employeeId: "e-alice", iso: "2026-08-17", shiftId: "matin" },
      { employeeId: "e-conge", iso: "2026-08-17", shiftId: "matin" },
    ];
    const lignes = pivoterParShift({
      jours: SEMAINE, creneaux, employees: EMPLOYEES, besoins,
      absences: ["e-conge_2026-08-17"], shifts: SHIFTS,
    });

    expect(lignes).toHaveLength(1);
    const [ligne] = lignes;
    // Seule Alice apparaît le lundi ; « En congé » a bien été retiré, malgré son créneau saisi.
    expect(ligne.jours[0]).toEqual({ iso: "2026-08-17", personnes: [{ id: "e-alice", nom: "Alice" }], requis: 2 });
  });

  it("une personne en congé approuvé dont c'était la seule affectation, sans besoin déclaré pour ce couple, ne crée pas de ligne du tout", () => {
    const creneaux: CreneauPeriode[] = [{ employeeId: "e-conge", iso: "2026-08-17", shiftId: "nuit" }];
    const lignes = pivoterParShift({
      jours: SEMAINE, creneaux, employees: EMPLOYEES, besoins: [],
      absences: ["e-conge_2026-08-17"], shifts: [{ id: "nuit" }],
    });
    expect(lignes).toEqual([]);
  });

  it("un salarié affecté sans poste renseigné est rattaché à un bloc « Sans poste » plutôt que d'être perdu", () => {
    const creneaux: CreneauPeriode[] = [{ employeeId: "e-theo", iso: "2026-08-20", shiftId: "matin" }]; // jeudi
    const lignes = pivoterParShift({ jours: SEMAINE, creneaux, employees: EMPLOYEES, besoins: [], absences: [], shifts: SHIFTS });

    expect(lignes).toHaveLength(1);
    expect(lignes[0].poste).toBe("Sans poste");
    expect(lignes[0].jours[3]).toEqual({ iso: "2026-08-20", personnes: [{ id: "e-theo", nom: "Théo" }], requis: null });
  });

  it("plusieurs besoins déclarés pour le même triplet shift/poste/jour se cumulent", () => {
    const besoins: BesoinPeriode[] = [
      { shiftId: "matin", poste: "Cuisine", jourSemaine: 1, nombreRequis: 1 },
      { shiftId: "matin", poste: "Cuisine", jourSemaine: 1, nombreRequis: 2 },
    ];
    const lignes = pivoterParShift({ jours: SEMAINE, creneaux: [], employees: EMPLOYEES, besoins, absences: [], shifts: SHIFTS });
    expect(lignes[0].jours[0].requis).toBe(3);
  });

  it("les lignes sont triées selon l'ordre des shifts fourni, puis par poste alphabétique à shift égal", () => {
    const besoins: BesoinPeriode[] = [
      { shiftId: "b", poste: "X", jourSemaine: 1, nombreRequis: 1 },
      { shiftId: "a", poste: "Y", jourSemaine: 1, nombreRequis: 1 },
      { shiftId: "a", poste: "X", jourSemaine: 1, nombreRequis: 1 },
    ];
    const lignes = pivoterParShift({
      jours: SEMAINE, creneaux: [], employees: [], besoins, absences: [],
      shifts: [{ id: "a" }, { id: "b" }],
    });
    expect(lignes.map((l) => `${l.shiftId}/${l.poste}`)).toEqual(["a/X", "a/Y", "b/X"]);
  });

  it("dans une case, plusieurs personnes sont triées par nom", () => {
    const employees: SalarieAffecte[] = [
      { id: "e-alice", nom: "Alice", poste: "Cuisine" },
      { id: "e-zoe", nom: "Zoé", poste: "Cuisine" },
    ];
    const creneaux: CreneauPeriode[] = [
      { employeeId: "e-zoe", iso: "2026-08-17", shiftId: "matin" },
      { employeeId: "e-alice", iso: "2026-08-17", shiftId: "matin" },
    ];
    const lignes = pivoterParShift({ jours: SEMAINE, creneaux, employees, besoins: [], absences: [], shifts: SHIFTS });
    expect(lignes[0].jours[0].personnes.map((p) => p.nom)).toEqual(["Alice", "Zoé"]);
  });
});
