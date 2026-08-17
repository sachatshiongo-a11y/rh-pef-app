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

  it("pose un titulaire disponible avant un renfort polyvalent, même si son id trie avant (B1)", () => {
    // Régression : l'équité ne doit jamais mélanger titulaires et renforts. Ids choisis pour que le
    // tri alphabétique mettrait le renfort devant si le mélange revenait — "aa-chef" < "zz-cuisinier".
    const r = genererPlanning(entreesBase({
      employes: [employe("zz-cuisinier", "Cuisinier"), employe("aa-chef", "Chef de partie")],
      besoins: [{ ...besoinLundiMatin, nombreRequis: 1 }],
      polyvalences: [{ posteSource: "Chef de partie", posteCible: "Cuisinier" }],
    }));
    const lundi = r.creneaux.filter((c) => iso2(c.date) === "2026-07-06");
    expect(lundi).toHaveLength(1);
    expect(lundi[0].employeeId).toBe("zz-cuisinier");
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
      { employeeId: "e1", lundi: d("2026-07-06"), heuresPlanifiees: 16, heuresContractuelles: 8, cause: "OPTION" },
    ]);
  });

  it("cas mixte : un candidat libre et un candidat au plafond, besoin de 2 → TOUS_AU_PLAFOND (A2)", () => {
    // "libre" couvre le besoin, "plafonne" est bloqué UNIQUEMENT par son plafond d'heures (déjà à
    // 8h/8h sur la semaine). Le diagnostic doit pointer TOUS_AU_PLAFOND (le levier actionnable),
    // pas EFFECTIF_INSUFFISANT — cocher « autoriser le dépassement » aurait tout couvert.
    const r = genererPlanning(entreesBase({
      employes: [
        { ...employe("libre"), heuresHebdomadaires: 48 },
        { ...employe("plafonne"), heuresHebdomadaires: 8 },
      ],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 2, nombreRequis: 2 }],
      existants: [{ employeeId: "plafonne", date: d("2026-07-06"), shiftId: SHIFT_MATIN.id }],
    }));
    const mardi = r.creneaux.filter((c) => iso2(c.date) === "2026-07-07");
    expect(mardi.map((c) => c.employeeId)).toEqual(["libre"]);
    expect(r.rapport.trous).toHaveLength(1);
    expect(r.rapport.trous[0].manque).toBe(1);
    expect(r.rapport.trous[0].raison).toBe("TOUS_AU_PLAFOND");
  });
});

describe("genererPlanning — cause des dépassements, jamais silencieux", () => {
  // « Chaque dépassement est listé dans le rapport » : trois chemins peuvent faire franchir le
  // contrat, chacun doit se déclarer avec sa propre cause — et aucun n'est bloqué en silence.

  it("TOLERANCE : le dernier shift de la passe complémentaire fait franchir le contrat (A3)", () => {
    // Contrat 45 h, shifts de 8 h : la tolérance d'un demi-shift (voulue, cf. `tientDansLesHeures`)
    // accepte tant que heuresSemaine <= 45 - 4 + 0.01 = 41.01, donc jusqu'au 6e jour (40 h avant
    // affectation) → 48 h posées, 3 h au-delà du contrat, sans qu'aucune option n'ait été cochée.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 45 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: { ...entreesBase().options, completer: true },
    }));
    expect(r.creneaux).toHaveLength(6); // le repos hebdomadaire plafonne à 6 jours
    expect(r.rapport.depassements).toEqual([
      { employeeId: "e1", lundi: d("2026-07-06"), heuresPlanifiees: 48, heuresContractuelles: 45, cause: "TOLERANCE" },
    ]);
  });

  it("MODELE : un modèle hebdomadaire pousse un salarié au-delà de son contrat, sans être bloqué (A3)", () => {
    // Contrat 16 h, modèle qui pose 3 shifts de 8 h (lun-mar-mer) = 24 h. Le modèle est une
    // affectation de la Direction : le créneau du 3e jour est posé quand même, et le dépassement
    // qui en résulte est déclaré.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 16 }],
      modeles: [1, 2, 3].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })),
    }));
    expect(r.creneaux.map((c) => iso2(c.date))).toEqual(["2026-07-06", "2026-07-07", "2026-07-08"]);
    expect(r.rapport.depassements).toEqual([
      { employeeId: "e1", lundi: d("2026-07-06"), heuresPlanifiees: 24, heuresContractuelles: 16, cause: "MODELE" },
    ]);
  });

  it("aucune entrée fantôme quand le salarié reste sous ou pile à son contrat", () => {
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 24 }], // 3 shifts de 8 h, pile au contrat
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      modeles: [1, 2].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })), // 16 h, sous le contrat
      options: { ...entreesBase().options, completer: true },
    }));
    expect(r.creneaux).toHaveLength(3); // 16 h de modèle + 8 h de complément = 24 h, pile
    expect(r.rapport.depassements).toEqual([]);
  });
});

describe("genererPlanning — mode « nombre de jours par semaine » forcé, et priorité des causes", () => {
  it("l'option ne déclare un dépassement QUE si les heures contractuelles sont réellement franchies (revue #1)", () => {
    // Cas démontré en revue : contrat 48 h, nbParSemaine: 2, option cochée. Le 3e jour est bloqué
    // par le plafond de JOURS (pas d'heures) et n'est posé que grâce à l'option — mais 3 × 8 h = 24 h
    // reste largement SOUS les 48 h contractuelles : ce n'est pas un dépassement, l'écran ne doit
    // rien en dire.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 48 }],
      besoins: [1, 2, 3].map((j) => ({ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: j, nombreRequis: 1 })),
      options: { ...entreesBase().options, nbParSemaine: 2, autoriserDepassementHeures: true },
    }));
    expect(r.creneaux).toHaveLength(3); // lundi, mardi posés normalement ; mercredi posé grâce à l'option
    expect(r.rapport.depassements).toEqual([]);
  });

  it("JOURS_FORCES : le nombre de jours par semaine forcé peut, à lui seul, franchir le contrat — sans option ni modèle (revue #2)", () => {
    // Contrat 24 h, nbParSemaine: 6, shifts de 8 h : le plafond forcé (6 jours) laisse passer 48 h,
    // sans qu'aucune option n'ait été cochée ni qu'aucun modèle ne soit en cause.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 24 }],
      besoins: [1, 2, 3, 4, 5, 6].map((j) => ({ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: j, nombreRequis: 1 })),
      options: { ...entreesBase().options, nbParSemaine: 6 },
    }));
    expect(r.creneaux).toHaveLength(6);
    expect(r.rapport.depassements).toEqual([
      { employeeId: "e1", lundi: d("2026-07-06"), heuresPlanifiees: 48, heuresContractuelles: 24, cause: "JOURS_FORCES" },
    ]);
  });

  it("priorité des causes : une OPTION plus tard dans la semaine promeut une TOLERANCE notée plus tôt (revue #3)", () => {
    // Contrat 20 h, option cochée, besoins du lundi au vendredi (8 h/jour, mode heures — pas de
    // nbParSemaine) : le mercredi franchit le contrat par la tolérance d'un demi-shift (aucune option
    // requise pour le poser), jeudi et vendredi ne passent QUE grâce à l'option. La cause affichée
    // doit être OPTION — la décision la plus actionnable — pas la TOLERANCE du mercredi.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 20 }],
      besoins: [1, 2, 3, 4, 5].map((j) => ({ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: j, nombreRequis: 1 })),
      options: { ...entreesBase().options, autoriserDepassementHeures: true },
    }));
    expect(r.creneaux).toHaveLength(5);
    expect(r.rapport.depassements).toEqual([
      { employeeId: "e1", lundi: d("2026-07-06"), heuresPlanifiees: 40, heuresContractuelles: 20, cause: "OPTION" },
    ]);
  });
});

describe("genererPlanning — shifts désactivés (B2)", () => {
  // `supprimerShift` désactive un shift (actif=false) sans purger les BesoinShift / PlanningModele
  // qui le référencent : le moteur ne reçoit que les shifts ACTIFS, mais peut recevoir des besoins
  // ou modèles pointant sur un shiftId absent. Il doit les ignorer, jamais les poser en silence.

  it("ignore un besoin référençant un shift absent des shifts actifs, et le signale", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1")],
      besoins: [{ shiftId: "shift-disparu", poste: "Cuisinier", jourSemaine: 1, nombreRequis: 1 }],
    }));
    expect(r.creneaux).toHaveLength(0);
    expect(r.rapport.shiftsInconnus).toEqual(["shift-disparu"]);
  });

  it("ignore un modèle référençant un shift absent des shifts actifs, et le signale", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1")],
      modeles: [{ employeeId: "e1", jour: 1, semaine: 0, shiftId: "shift-disparu" }],
    }));
    expect(r.creneaux).toHaveLength(0);
    expect(r.rapport.shiftsInconnus).toEqual(["shift-disparu"]);
  });
});

describe("genererPlanning — passe complémentaire", () => {
  const optionsCompleter = { ...entreesBase().options, completer: true, jours: [1, 2, 3, 4, 5, 6] };

  it("remplit jusqu'aux heures avec le premier shift acceptable du poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 24 }], // 3 shifts de 8 h
      shiftsPoste: [
        { poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 },
        { poste: "Cuisinier", shiftId: SHIFT_SOIR.id, ordre: 1 },
      ],
      options: optionsCompleter,
    }));
    expect(r.creneaux).toHaveLength(3);
    expect(r.creneaux.every((c) => c.shiftId === SHIFT_MATIN.id)).toBe(true);
  });

  it("respecte un shift imposé par l'utilisateur, en ignorant la liste du poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: { ...optionsCompleter, shiftId: SHIFT_SOIR.id },
    }));
    expect(r.creneaux[0].shiftId).toBe(SHIFT_SOIR.id);
  });

  it("ne pose RIEN et nomme le salarié quand son poste n'a aucun shift acceptable", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1", "Plongeur")],
      shiftsPoste: [],
      options: optionsCompleter,
    }));
    expect(r.creneaux).toHaveLength(0);
    expect(r.rapport.sansShiftPoste).toEqual([{ employeeId: "e1", poste: "Plongeur" }]);
  });

  it("ne dépasse JAMAIS le plafond dans la passe complémentaire, même avec l'option", () => {
    // Déplacé depuis la tâche 4 : il porte sur cette passe, il ne pouvait donc pas y être écrit
    // sans être rouge. Aucun besoin déclaré ici — rien ne justifie de pousser quelqu'un au-delà
    // de ses heures quand aucune couverture ne l'exige.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: { ...optionsCompleter, autoriserDepassementHeures: true },
    }));
    expect(r.creneaux).toHaveLength(1);
    expect(r.rapport.depassements).toHaveLength(0);
  });

  it("rapporte les salariés restés sous leurs heures, au prorata de la période", () => {
    // Semaine complète (6 jours ouvrables → 48 h attendues), mais 2 jours de congé approuvé :
    // seuls 4 jours sont planifiables, soit 32 h. Le manque est réel et doit être signalé.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-06"), fin: d("2026-07-11"),
      employes: [{ ...employe("e1"), heuresHebdomadaires: 48 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      conges: [{ employeeId: "e1", dateDebut: d("2026-07-09"), dateFin: d("2026-07-10") }],
      options: optionsCompleter,
    }));
    expect(r.rapport.sousHeures).toEqual([
      { employeeId: "e1", heuresPlanifiees: 32, heuresContractuelles: 48 },
    ]);
  });

  it("n'annonce AUCUN manque sur une période à cheval qui couvre bien une semaine de travail", () => {
    // Le piège corrigé : mercredi → mardi touche DEUX lundis civils mais ne couvre qu'une seule
    // semaine de travail. Compter deux fois l'horaire hebdomadaire inventait un manque de 48 h.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-08"), fin: d("2026-07-14"), // mercredi → mardi
      employes: [{ ...employe("e1"), heuresHebdomadaires: 48 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: optionsCompleter,
    }));
    expect(r.rapport.sousHeures).toEqual([]);
  });
});

describe("genererPlanning — équité", () => {
  it("choisit d'abord celui qui a le moins d'heures sur la période", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("charge"), employe("leger")],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 1, nombreRequis: 1 }],
      existants: [{ employeeId: "charge", date: d("2026-07-07"), shiftId: SHIFT_MATIN.id }],
    }));
    expect(r.creneaux.find((c) => iso2(c.date) === "2026-07-06")?.employeeId).toBe("leger");
  });

  it("fait tourner les dimanches d'après l'historique, à heures égales", () => {
    // Les deux ont autant d'heures sur la période ; « habitue » a déjà pris 3 dimanches avant.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-12"), fin: d("2026-07-12"), // dimanche
      employes: [employe("habitue"), employe("repose")],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 0, nombreRequis: 1 }],
      options: { ...entreesBase().options, jours: [0] },
      historique: ["2026-06-21", "2026-06-28", "2026-07-05"].map((j) => ({
        employeeId: "habitue", date: d(j), shiftId: SHIFT_MATIN.id,
      })),
    }));
    expect(r.creneaux[0].employeeId).toBe("repose");
  });

  it("fait tourner les jours pénibles d'après un FÉRIÉ travaillé dans l'historique, à heures égales (A6)", () => {
    // « habitue » a travaillé un jour férié AVANT la période (dans l'historique) ; « repose » non.
    // Les deux ont autant d'heures sur la période (0 : rien encore posé). Pour un jour pénible DE la
    // période (ici un dimanche), l'équité doit départager sur les jours pénibles CUMULÉS — historique
    // compris — et donc choisir « repose ». Ce férié n'est reconnu comme pénible par le moteur que
    // s'il figure dans `entrees.feries`, quelle que soit sa date : c'est précisément ce que
    // `genererPlanningAuto` doit désormais lire sur [debutHistorique, fin], pas seulement [debut, fin].
    const ferieHistorique = d("2026-06-24"); // mercredi, largement avant la période
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-12"), fin: d("2026-07-12"), // dimanche seul
      employes: [employe("habitue"), employe("repose")],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 0, nombreRequis: 1 }],
      options: { ...entreesBase().options, jours: [0] },
      historique: [{ employeeId: "habitue", date: ferieHistorique, shiftId: SHIFT_MATIN.id }],
      feries: [ferieHistorique],
    }));
    expect(r.creneaux[0].employeeId).toBe("repose");
  });

  it("alterne les shifts acceptables d'une génération à l'autre, d'après l'historique", () => {
    // e1 a déjà beaucoup fait « Matin » les semaines précédentes : « Soir » passe devant.
    // L'ordre est figé pour toute la génération — on ne veut pas d'un cuisinier qui bascule
    // matin/soir d'un jour sur l'autre.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
      shiftsPoste: [
        { poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 },
        { poste: "Cuisinier", shiftId: SHIFT_SOIR.id, ordre: 1 },
      ],
      historique: ["2026-06-29", "2026-06-30", "2026-07-01"].map((j) => ({
        employeeId: "e1", date: d(j), shiftId: SHIFT_MATIN.id,
      })),
      options: { ...entreesBase().options, completer: true },
    }));
    expect(r.creneaux[0].shiftId).toBe(SHIFT_SOIR.id);
  });
});

describe("genererPlanning — amorçage des quotas hebdomadaires par l'historique (A1)", () => {
  // La génération se fait au mois : la période ne démarre presque jamais un lundi. Le début de la
  // semaine civile tombe alors dans l'historique, strictement antérieur à `debut`. Sans amorçage,
  // le moteur croit cette semaine vierge et peut dépasser les heures contractuelles sans que
  // `rapport.depassements` ne le dise — alors que l'écran promet que chaque dépassement y figure.
  const entreesACheval = (surcharge: Partial<EntreesGeneration> = {}) => entreesBase({
    debut: d("2026-07-08"), fin: d("2026-07-12"), // mercredi 8 → dimanche 12 : ne démarre pas un lundi
    employes: [{ ...employe("e1"), heuresHebdomadaires: 40 }],
    historique: [
      { employeeId: "e1", date: d("2026-07-06"), shiftId: SHIFT_MATIN.id }, // lundi, 8 h
      { employeeId: "e1", date: d("2026-07-07"), shiftId: SHIFT_MATIN.id }, // mardi, 8 h
    ],
    shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
    options: { ...entreesBase().options, completer: true },
    ...surcharge,
  });

  it("les heures d'avant la période comptent : la semaine s'arrête à 40 h, pas 48", () => {
    const r = genererPlanning(entreesACheval());
    // Sans la correction, le moteur ignore les 16 h de lundi/mardi et pose 4 jours (mercredi à
    // samedi, dimanche étant de toute façon bloqué par les 6 jours consécutifs) : 32 h de période
    // + 16 h d'historique = 48 h, sans le moindre dépassement rapporté.
    expect(r.creneaux).toHaveLength(3); // mercredi, jeudi, vendredi
    const heuresSemaineCivile = r.creneaux.length * 8 + 16; // + les 16 h de l'historique
    expect(heuresSemaineCivile).toBe(40); // pile la contractuelle
  });

  it("les heures d'historique comptent dans le total déclaré par `rapport.depassements`", () => {
    // On ne teste pas le plafond des 6 jours consécutifs ici : sur une semaine civile lundi→dimanche,
    // 6 jours travaillés hors dimanche sont forcément consécutifs, donc le plafond en JOURS et la
    // règle des jours consécutifs (qui lit `occupe`, déjà alimenté par l'historique même sans la
    // correction A1) coïncident presque toujours — un tel test passerait avec ou sans l'amorçage,
    // et ne prouverait rien (c'est justement ce qui a été constaté sur le test qu'il remplace).
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-08"), fin: d("2026-07-08"), // mercredi seul : la semaine civile a démarré avant
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }], // faible horaire : un seul shift le comble déjà
      historique: [
        { employeeId: "e1", date: d("2026-07-06"), shiftId: SHIFT_MATIN.id }, // lundi, 8 h : la contractuelle est déjà atteinte
      ],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 3, nombreRequis: 1 }], // mercredi
      options: { ...entreesBase().options, autoriserDepassementHeures: true },
    }));
    // Sans l'amorçage, le moteur croit la semaine vierge : le shift du mercredi tient dans les 8 h
    // « restantes », aucun dépassement n'est détecté et `depassements` reste vide.
    expect(r.rapport.depassements).toHaveLength(1);
    expect(r.rapport.depassements[0]).toMatchObject({
      employeeId: "e1",
      heuresPlanifiees: 16, // 8 h d'historique (lundi) + 8 h posées ce mercredi
      heuresContractuelles: 8,
    });
  });

  it("`ecraser: true` ne fait pas oublier l'historique — même résultat sur les heures de la semaine", () => {
    // `ecraser` purge les créneaux DE la période (`existants`), jamais l'historique, qui lui est
    // antérieur à `debut` et n'a donc rien à voir avec ce que l'écraser régénère.
    const r = genererPlanning(entreesACheval({ options: { ...entreesBase().options, completer: true, ecraser: true } }));
    expect(r.creneaux).toHaveLength(3);
    expect(r.creneaux.length * 8 + 16).toBe(40);
  });
});
