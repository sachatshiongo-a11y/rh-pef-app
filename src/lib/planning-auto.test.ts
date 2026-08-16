import { describe, expect, it } from "vitest";
import { genererPlanning, type EntreesGeneration, type EmployePlanning } from "@/lib/planning-auto";

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");

const SHIFT_MATIN = { id: "sh-matin", nom: "Matin cuisine", dureeHeures: 8 };
const SHIFT_SOIR = { id: "sh-soir", nom: "Soir cuisine", dureeHeures: 8 };

const employe = (id: string, poste = "Cuisinier"): EmployePlanning => ({
  id, nom: `Employé ${id}`, poste, secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48,
});

/** Entrées minimales : une semaine complète lundi 6 → dimanche 12 juillet 2026, tout vide. */
export function entreesBase(surcharge: Partial<EntreesGeneration> = {}): EntreesGeneration {
  return {
    debut: d("2026-07-06"),
    fin: d("2026-07-12"),
    employes: [employe("e1")],
    shifts: [SHIFT_MATIN, SHIFT_SOIR],
    besoins: [],
    shiftsPoste: [],
    polyvalences: [],
    modeles: [],
    conges: [],
    feries: [],
    existants: [],
    historique: [],
    options: {
      jours: [0, 1, 2, 3, 4, 5, 6], // tous les jours autorisés : c'est le repos qui doit limiter
      nbParSemaine: 0,
      inclureFeries: false,
      utiliserModeles: true,
      ecraser: false,
      completer: false,
      autoriserDepassementHeures: false,
    },
    ...surcharge,
  };
}

describe("genererPlanning — modèles hebdomadaires", () => {
  it("pose les shifts du modèle sur les bons jours", () => {
    const r = genererPlanning(entreesBase({
      modeles: [
        { employeeId: "e1", jour: 1, semaine: 0, shiftId: SHIFT_MATIN.id }, // lundi, chaque semaine
        { employeeId: "e1", jour: 3, semaine: 0, shiftId: SHIFT_SOIR.id },  // mercredi
      ],
    }));
    expect(r.creneaux.map((c) => `${c.date.toISOString().slice(0, 10)}:${c.shiftId}`)).toEqual([
      "2026-07-06:sh-matin",
      "2026-07-08:sh-soir",
    ]);
  });

  it("ignore les modèles quand l'option est décochée", () => {
    const r = genererPlanning(entreesBase({
      modeles: [{ employeeId: "e1", jour: 1, semaine: 0, shiftId: SHIFT_MATIN.id }],
      options: { ...entreesBase().options, utiliserModeles: false },
    }));
    expect(r.creneaux).toHaveLength(0);
  });
});

describe("genererPlanning — contraintes dures", () => {
  it("ne pose jamais de créneau pendant un congé approuvé", () => {
    const r = genererPlanning(entreesBase({
      modeles: [1, 2, 3].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })),
      conges: [{ employeeId: "e1", dateDebut: d("2026-07-07"), dateFin: d("2026-07-08") }],
    }));
    const jours = r.creneaux.map((c) => c.date.toISOString().slice(0, 10));
    expect(jours).toEqual(["2026-07-06"]); // mardi et mercredi tombent dans le congé
  });

  it("ne pose jamais deux shifts le même jour pour la même personne", () => {
    const r = genererPlanning(entreesBase({
      modeles: [
        { employeeId: "e1", jour: 1, semaine: 0, shiftId: SHIFT_MATIN.id },
        { employeeId: "e1", jour: 1, semaine: 1, shiftId: SHIFT_SOIR.id }, // même lundi, autre couche
      ],
    }));
    const lundis = r.creneaux.filter((c) => c.date.toISOString().startsWith("2026-07-06"));
    expect(lundis).toHaveLength(1);
  });

  it("laisse AU MOINS un jour de repos dans la semaine, même si les 7 jours sont autorisés", () => {
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 100 }], // heures assez hautes pour ne pas limiter
      modeles: [0, 1, 2, 3, 4, 5, 6].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })),
    }));
    expect(r.creneaux.length).toBeLessThanOrEqual(6);
  });

  it("compte les jours consécutifs à cheval sur deux semaines, et repart après un vrai repos", () => {
    // Vendredi 3, samedi 4 et dimanche 5 juillet déjà travaillés (semaine précédente, via
    // l'historique). La série continue donc au-delà de la frontière de semaine : lundi 6, mardi 7
    // et mercredi 8 atteignent 6 jours d'affilée, et jeudi 9 est refusé.
    //
    // Jeudi 9 devient alors un VRAI jour de repos, ce qui relance légitimement le compteur :
    // vendredi 10 et samedi 11 sont posés. Le résultat respecte les deux règles — jamais plus de
    // 6 jours d'affilée, et au moins un repos dans la semaine du 6 (jeudi 9 et dimanche 12).
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 100 }],
      historique: [
        { employeeId: "e1", date: d("2026-07-03"), shiftId: SHIFT_MATIN.id },
        { employeeId: "e1", date: d("2026-07-04"), shiftId: SHIFT_MATIN.id },
        { employeeId: "e1", date: d("2026-07-05"), shiftId: SHIFT_MATIN.id }, // dimanche travaillé
      ],
      modeles: [1, 2, 3, 4, 5, 6].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })),
    }));
    expect(r.creneaux.map((c) => c.date.toISOString().slice(0, 10))).toEqual([
      "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-10", "2026-07-11",
    ]);
  });
});
