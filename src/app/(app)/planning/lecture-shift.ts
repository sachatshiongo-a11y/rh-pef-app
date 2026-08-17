// Deux calculs purs pour la vue « Par shift » et le regroupement des lignes de la grille semaine
// (conception docs/superpowers/specs/2026-08-17-planning-visibilite-design.md, §4/§5/§6). Colocalisé
// avec planning-semaine.tsx, comme creneaux.ts et raisons.ts : aucune I/O, aucune horloge, dates en
// ISO (YYYY-MM-DD), tout vient des paramètres.

import type { SemaineEmployee, SemaineGroupe } from "./planning-semaine";

/** Bloc de repli explicite : un salarié sans poste renseigné n'est jamais perdu dans un groupe. */
const SANS_POSTE = "Sans poste";

const parNom = (a: { nom: string }, b: { nom: string }) => a.nom.localeCompare(b.nom, "fr");

// -------------------------------------------------------------------------------------------
// 1. Le regroupement des salariés (§5)
// -------------------------------------------------------------------------------------------

export type CritereGroupe = "categorie" | "poste" | "aucun";

/** Un salarié tel que connu du regroupement : les champs qui pilotent le classement s'ajoutent à la
 *  forme consommée par la grille (`SemaineEmployee`). */
export type SalarieAClasser = SemaineEmployee & {
  poste: string;
  categorie: "BRIGADE" | "BACKOFFICE";
};

/**
 * Regroupe les salariés selon le critère choisi : un bloc par valeur, trié de façon stable et
 * prévisible, effectif juste. Un salarié sans poste renseigné (poste vide ou blanc) est rangé dans un
 * bloc « Sans poste » explicite plutôt que d'être silencieusement omis — perdre quelqu'un dans un
 * planning est le pire défaut possible ici.
 */
export function grouperSalaries(employees: SalarieAClasser[], critere: CritereGroupe): SemaineGroupe[] {
  if (critere === "aucun") {
    return [{ titre: "Tous les salariés", employees: [...employees].sort(parNom) }];
  }

  if (critere === "categorie") {
    return [
      { titre: "Brigade", employees: employees.filter((e) => e.categorie === "BRIGADE").sort(parNom) },
      { titre: "Backoffice", employees: employees.filter((e) => e.categorie === "BACKOFFICE").sort(parNom) },
    ];
  }

  // critere === "poste"
  const parPoste = new Map<string, SalarieAClasser[]>();
  for (const e of employees) {
    const cle = e.poste.trim() || SANS_POSTE;
    const liste = parPoste.get(cle);
    if (liste) liste.push(e);
    else parPoste.set(cle, [e]);
  }
  const postesTries = [...parPoste.keys()].filter((p) => p !== SANS_POSTE).sort((a, b) => a.localeCompare(b, "fr"));
  const groupes = postesTries.map((titre) => ({ titre, employees: parPoste.get(titre)!.sort(parNom) }));
  const sansPoste = parPoste.get(SANS_POSTE);
  if (sansPoste) groupes.push({ titre: SANS_POSTE, employees: sansPoste.sort(parNom) }); // toujours en dernier, jamais omis
  return groupes;
}

// -------------------------------------------------------------------------------------------
// 2. Le pivot par shift (§4)
// -------------------------------------------------------------------------------------------

/** dow : 0 = dimanche … 6 = samedi, comme `Date#getUTCDay()` et `BesoinShift.jourSemaine`. */
export type JourPeriode = { iso: string; dow: number };
export type CreneauPeriode = { employeeId: string; iso: string; shiftId: string };
export type SalarieAffecte = { id: string; nom: string; poste: string };
export type BesoinPeriode = { shiftId: string; poste: string; jourSemaine: number; nombreRequis: number };
/** Ordre d'affichage des shifts (déjà trié par l'appelant, ex. `Shift.ordre`). */
export type ShiftOrdonne = { id: string };

export type PersonneAffectee = { id: string; nom: string };
export type CaseShift = { iso: string; personnes: PersonneAffectee[]; requis: number | null };
export type LigneShiftPoste = { shiftId: string; poste: string; jours: CaseShift[] };

/**
 * Pivote les créneaux de la période en lignes shift × poste pour la lecture « Par shift ».
 *
 * - Une ligne par couple shift × poste **réellement concerné** : besoin déclaré (sur au moins un
 *   jour de la période) ou au moins une affectation effective. Jamais de ligne vide.
 * - Chaque ligne porte un jour par jour de la période, dans l'ordre fourni : un jour sans personne
 *   produit une case vide (`personnes: []`), jamais une ligne manquante.
 * - Le compte face au besoin (`requis`) n'est renseigné que pour les jours où un besoin est déclaré
 *   pour ce shift × poste ; `null` sinon (pas de convention à zéro, qui laisserait croire à un besoin
 *   nul plutôt qu'à une absence de besoin déclaré).
 * - Un salarié en congé approuvé (clé `${employeeId}_${iso}` présente dans `absences`) est retiré de
 *   ses affectations avant tout calcul : il n'apparaît dans aucune case, et si c'était sa seule
 *   affectation pour un couple sans besoin déclaré, ce couple n'est pas « concerné » et n'a pas de
 *   ligne — cohérent avec « n'apparaît nulle part ».
 * - Un salarié affecté sans poste renseigné est rattaché au bloc « Sans poste » plutôt que d'être
 *   perdu du pivot.
 */
export function pivoterParShift(params: {
  jours: JourPeriode[];
  creneaux: CreneauPeriode[];
  employees: SalarieAffecte[];
  besoins: BesoinPeriode[];
  absences: Iterable<string>;
  shifts: ShiftOrdonne[];
}): LigneShiftPoste[] {
  const { jours, creneaux, employees, besoins, absences, shifts } = params;
  const absSet = absences instanceof Set ? absences : new Set(absences);
  const empParId = new Map(employees.map((e) => [e.id, e]));
  const isoConnus = new Set(jours.map((j) => j.iso));

  // Besoins agrégés : `${shiftId}|${poste}|${jourSemaine}` -> total requis (somme défensive, au cas
  // où plusieurs lignes de besoin coexisteraient pour le même triplet).
  const requisMap = new Map<string, number>();
  for (const b of besoins) {
    const cle = `${b.shiftId}|${b.poste}|${b.jourSemaine}`;
    requisMap.set(cle, (requisMap.get(cle) ?? 0) + b.nombreRequis);
  }

  // Affectations effectives (congé exclu) : `${shiftId}|${poste}` -> iso -> personnes.
  const affectations = new Map<string, Map<string, PersonneAffectee[]>>();
  for (const c of creneaux) {
    if (!isoConnus.has(c.iso)) continue; // hors période
    if (absSet.has(`${c.employeeId}_${c.iso}`)) continue; // en congé approuvé : n'apparaît nulle part
    const emp = empParId.get(c.employeeId);
    if (!emp) continue;
    const poste = emp.poste.trim() || SANS_POSTE;
    const clePaire = `${c.shiftId}|${poste}`;
    const parJour = affectations.get(clePaire) ?? new Map<string, PersonneAffectee[]>();
    const liste = parJour.get(c.iso) ?? [];
    liste.push({ id: emp.id, nom: emp.nom });
    parJour.set(c.iso, liste);
    affectations.set(clePaire, parJour);
  }

  // Couples shift × poste réellement concernés : besoin déclaré OU affectation effective.
  const paires = new Set<string>(affectations.keys());
  for (const b of besoins) paires.add(`${b.shiftId}|${b.poste}`);

  const ordreShift = new Map(shifts.map((s, i) => [s.id, i]));

  const lignes: LigneShiftPoste[] = [...paires].map((cle) => {
    const i = cle.indexOf("|");
    const shiftId = cle.slice(0, i);
    const poste = cle.slice(i + 1);
    const parJour = affectations.get(cle);
    return {
      shiftId,
      poste,
      jours: jours.map((j) => ({
        iso: j.iso,
        personnes: [...(parJour?.get(j.iso) ?? [])].sort(parNom),
        requis: requisMap.get(`${shiftId}|${poste}|${j.dow}`) ?? null,
      })),
    };
  });

  // Ordre prévisible : celui des shifts fourni par l'appelant, puis le poste alphabétique.
  lignes.sort((a, b) => {
    const oa = ordreShift.get(a.shiftId) ?? Number.MAX_SAFE_INTEGER;
    const ob = ordreShift.get(b.shiftId) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.poste.localeCompare(b.poste, "fr");
  });

  return lignes;
}
