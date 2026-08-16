import { describe, expect, it } from "vitest";
import { genererPlanning, type EntreesGeneration, type EmployePlanning } from "@/lib/planning-auto";

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");
const iso2 = (x: Date) => x.toISOString().slice(0, 10);

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

describe("genererPlanning — couverture des besoins", () => {
  const besoinLundiMatin = { shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 1, nombreRequis: 2 };

  it("couvre un besoin avec les titulaires du poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1"), employe("e2"), employe("e3")],
      besoins: [besoinLundiMatin],
    }));
    const lundi = r.creneaux.filter((c) => iso2(c.date) === "2026-07-06");
    expect(lundi).toHaveLength(2);
    expect(r.rapport.trous).toHaveLength(0);
  });

  it("complète avec la polyvalence quand les titulaires ne suffisent pas", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1"), employe("chef", "Chef de partie")],
      besoins: [besoinLundiMatin],
      polyvalences: [{ posteSource: "Chef de partie", posteCible: "Cuisinier" }],
    }));
    expect(r.creneaux.filter((c) => iso2(c.date) === "2026-07-06")).toHaveLength(2);
    expect(r.rapport.trous).toHaveLength(0);
  });

  it("rapporte AUCUN_TITULAIRE quand personne ne tient le poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1", "Plongeur")],
      besoins: [besoinLundiMatin],
    }));
    expect(r.rapport.trous).toEqual([
      { date: d("2026-07-06"), shiftId: SHIFT_MATIN.id, poste: "Cuisinier", manque: 2, raison: "AUCUN_TITULAIRE" },
    ]);
  });

  it("rapporte EFFECTIF_INSUFFISANT quand tout le monde était libre mais en nombre insuffisant", () => {
    // Le piège que ce test verrouille : les candidats posés pour CE besoin ne doivent pas être
    // relus comme « déjà pris ». Ici les deux étaient libres, ils sont posés, il en manquait un
    // troisième — la cause est l'effectif, pas un blocage.
    const r = genererPlanning(entreesBase({
      employes: [employe("e1"), employe("chef", "Chef de partie")],
      besoins: [{ ...besoinLundiMatin, nombreRequis: 3 }],
      polyvalences: [{ posteSource: "Chef de partie", posteCible: "Cuisinier" }],
    }));
    expect(r.creneaux.filter((c) => iso2(c.date) === "2026-07-06")).toHaveLength(2);
    expect(r.rapport.trous[0].manque).toBe(1);
    expect(r.rapport.trous[0].raison).toBe("EFFECTIF_INSUFFISANT");
  });

  it("rapporte TOUS_EN_CONGE", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1")],
      besoins: [{ ...besoinLundiMatin, nombreRequis: 1 }],
      conges: [{ employeeId: "e1", dateDebut: d("2026-07-06"), dateFin: d("2026-07-06") }],
    }));
    expect(r.rapport.trous[0].raison).toBe("TOUS_EN_CONGE");
  });

  it("rapporte TOUS_DEJA_PRIS quand chacun a déjà un shift ce jour-là", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1")],
      besoins: [{ ...besoinLundiMatin, nombreRequis: 1 }],
      existants: [{ employeeId: "e1", date: d("2026-07-06"), shiftId: SHIFT_SOIR.id }],
    }));
    expect(r.rapport.trous[0].raison).toBe("TOUS_DEJA_PRIS");
  });

  it("rapporte TOUS_AU_REPOS quand la règle de repos bloque tout le monde", () => {
    // e1 a déjà 6 jours posés dans la semaine : le 7e est interdit par le repos hebdomadaire.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-12"), fin: d("2026-07-12"), // dimanche seul
      employes: [{ ...employe("e1"), heuresHebdomadaires: 100 }],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 0, nombreRequis: 1 }],
      existants: ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"]
        .map((j) => ({ employeeId: "e1", date: d(j), shiftId: SHIFT_MATIN.id })),
    }));
    expect(r.rapport.trous[0].raison).toBe("TOUS_AU_REPOS");
  });
});

describe("genererPlanning — plafond d'heures", () => {
  /** e1 : 8 h contractuelles/semaine → un seul shift de 8 h tient dans son plafond. */
  const entreesPlafond = (autoriser: boolean) => entreesBase({
    employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
    besoins: [
      { shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 1, nombreRequis: 1 },
      { shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 2, nombreRequis: 1 },
    ],
    options: { ...entreesBase().options, autoriserDepassementHeures: autoriser },
  });

  it("sans l'option, laisse le besoin découvert et rapporte TOUS_AU_PLAFOND", () => {
    const r = genererPlanning(entreesPlafond(false));
    expect(r.creneaux).toHaveLength(1); // seul le lundi tient dans les 8 h
    expect(r.rapport.trous).toHaveLength(1);
    expect(r.rapport.trous[0].raison).toBe("TOUS_AU_PLAFOND");
    expect(r.rapport.depassements).toHaveLength(0);
  });

  it("avec l'option, couvre le besoin ET liste le dépassement engagé", () => {
    const r = genererPlanning(entreesPlafond(true));
    expect(r.creneaux).toHaveLength(2);
    expect(r.rapport.trous).toHaveLength(0);
    expect(r.rapport.depassements).toEqual([
      { employeeId: "e1", lundi: d("2026-07-06"), heuresPlanifiees: 16, heuresContractuelles: 8 },
    ]);
  });

  it("ne dépasse JAMAIS le plafond dans la passe complémentaire, même avec l'option", () => {
    // Aucun besoin déclaré : rien ne justifie de pousser quelqu'un au-delà de ses heures.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: { ...entreesBase().options, completer: true, autoriserDepassementHeures: true },
    }));
    expect(r.creneaux).toHaveLength(1);
    expect(r.rapport.depassements).toHaveLength(0);
  });
});
