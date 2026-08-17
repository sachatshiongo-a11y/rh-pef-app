// Écart planning prévu / réalisé — module PUR (aucune I/O, aucun import de Prisma ni de
// src/app/), même convention que src/lib/planning-auto.ts et src/lib/payroll.ts.
//
// Répond à deux questions, et seulement deux (voir docs/superpowers/specs/2026-08-17-planning-ecart-…) :
//   1. La couverture a-t-elle tenu ? (jour × shift × poste : prévus, tenus, et pourquoi les autres non)
//   2. Les heures prévues ont-elles été faites ? (par salarié : planifiées vs réalisées)
//
// Toutes les dates sont des dates PURES en UTC : lire avec getUTC*, jamais getDay()/getDate().
//
// Quatre décisions cadrantes (§3 de la spec), à ne pas trahir :
//  1. Un créneau planifié est TENU si le code du jour est "P". Tout autre code = non tenu, et le
//     code lui-même est la raison.
//  2. Un créneau planifié SANS aucun code saisi n'est PAS une absence : c'est NON_RENSEIGNE, un trou
//     de saisie administratif, jamais imputé au salarié.
//  3. Les heures réalisées viennent des heures saisies par jour (OvertimeEntry côté appelant). Un
//     jour codé "P" sans heures compte 0 heure réalisée et est signalé à part
//     (`joursPresenceSansHeures`) — cette règle vaut pour tout jour codé "P", planifié ou non.
//  4. Le travail HORS planning (jour travaillé sans créneau prévu) compte dans l'écart d'heures et
//     dans `joursTravaillesHorsPlanning`, mais ne couvre jamais un besoin : la couverture ne se
//     construit qu'à partir des créneaux réellement planifiés (voir `calculerEcarts`).

export type EmployeEcart = { id: string; nom: string; poste: string };
export type ShiftEcart = { id: string; nom: string; dureeHeures: number };

/** Créneau planifié : employé × date × shift (reflet de `PlanningCreneau`). */
export type CreneauEcart = { employeeId: string; date: Date; shiftId: string };
/** Code du jour saisi (reflet de `Attendance.code`) — chaîne libre, pas l'enum Prisma : ce module
 *  ne connaît pas Prisma. */
export type CodeJourEcart = { employeeId: string; date: Date; code: string };
/** Heures réellement travaillées un jour donné (reflet de `OvertimeEntry.heuresTravaillees`). */
export type HeuresJourEcart = { employeeId: string; date: Date; heuresTravaillees: number };

export type EntreesEcart = {
  debut: Date;
  fin: Date;
  employes: EmployeEcart[];
  shifts: ShiftEcart[];
  /** Créneaux planifiés — filtrés ou non sur [debut, fin], le module refiltre lui-même. */
  creneaux: CreneauEcart[];
  /** Codes de présence — filtrés ou non sur [debut, fin], le module refiltre lui-même. */
  codes: CodeJourEcart[];
  /** Heures saisies — filtrées ou non sur [debut, fin], le module refiltre lui-même. */
  heures: HeuresJourEcart[];
};

export type IssueCreneau = "TENU" | "ABSENT" | "NON_RENSEIGNE";

export type LigneCouverture = {
  date: Date;
  shiftId: string;
  poste: string;
  prevus: number;
  tenus: number;
  /** Détail des créneaux non tenus : qui, et le code qui l'explique (null = non renseigné). */
  manquants: { employeeId: string; code: string | null }[];
};

export type LigneHeures = {
  employeeId: string;
  heuresPlanifiees: number;
  heuresRealisees: number;
  /** réalisé − planifié ; négatif = manque. */
  ecart: number;
  joursPlanifies: number;
  joursTenus: number;
  joursTravaillesHorsPlanning: number;
  /** Jours codés « P » sans aucune heure saisie — la paie les valorisera à 0. */
  joursPresenceSansHeures: number;
};

export type TotalEcart = {
  creneauxPrevus: number;
  creneauxTenus: number;
  creneauxAbsents: number;
  creneauxNonRenseignes: number;
  heuresPlanifiees: number;
  heuresRealisees: number;
};

export type ResultatEcart = {
  /** Une ligne par (date, shift, poste) où au moins un créneau a été planifié — y compris les
   *  jours entièrement tenus : c'est à l'écran (hors périmètre de ce module) de ne lister que ceux
   *  qui n'ont pas tenu et de résumer les autres par un compteur. */
  couverture: LigneCouverture[];
  /** Une ligne par employé d'`entrees.employes`, dans l'ordre d'entrée. */
  heures: LigneHeures[];
  total: TotalEcart;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const arrondi2 = (n: number) => Math.round(n * 100) / 100;

/** Le code du jour explique-t-il un créneau tenu, absent, ou l'absence de toute saisie ?
 *  `null`/`undefined` = aucun code saisi pour ce jour → NON_RENSEIGNE (décision 2, jamais ABSENT). */
export function issueCreneau(code: string | null | undefined): IssueCreneau {
  if (code === "P") return "TENU";
  if (code == null) return "NON_RENSEIGNE";
  return "ABSENT";
}

export function calculerEcarts(entrees: EntreesEcart): ResultatEcart {
  const { debut, fin } = entrees;
  const dansPeriode = (d: Date) => d.getTime() >= debut.getTime() && d.getTime() <= fin.getTime();

  const posteDe = new Map(entrees.employes.map((e) => [e.id, e.poste]));
  const dureeParShift = new Map(entrees.shifts.map((s) => [s.id, s.dureeHeures]));

  const creneauxPeriode = entrees.creneaux.filter((c) => dansPeriode(c.date));

  // Index par employé → date ISO, pour éviter toute collision de clé (deux id ne doivent jamais se
  // confondre par un simple préfixe de chaîne, ex. "e1" et "e10").
  const codeParEmploye = new Map<string, Map<string, string>>();
  for (const c of entrees.codes) {
    if (!dansPeriode(c.date)) continue;
    const m = codeParEmploye.get(c.employeeId) ?? new Map<string, string>();
    m.set(iso(c.date), c.code);
    codeParEmploye.set(c.employeeId, m);
  }
  const heuresParEmploye = new Map<string, Map<string, number>>();
  for (const h of entrees.heures) {
    if (!dansPeriode(h.date)) continue;
    const m = heuresParEmploye.get(h.employeeId) ?? new Map<string, number>();
    m.set(iso(h.date), h.heuresTravaillees);
    heuresParEmploye.set(h.employeeId, m);
  }
  const creneauxParEmploye = new Map<string, Map<string, CreneauEcart>>();
  for (const c of creneauxPeriode) {
    const m = creneauxParEmploye.get(c.employeeId) ?? new Map<string, CreneauEcart>();
    m.set(iso(c.date), c);
    creneauxParEmploye.set(c.employeeId, m);
  }

  // ── Couverture : regroupe les créneaux planifiés par (jour, shift, poste) ────────────────────
  const groupes = new Map<string, LigneCouverture>();
  for (const c of creneauxPeriode) {
    const poste = posteDe.get(c.employeeId) ?? "";
    const cle = `${iso(c.date)}_${c.shiftId}_${poste}`;
    let g = groupes.get(cle);
    if (!g) {
      g = { date: c.date, shiftId: c.shiftId, poste, prevus: 0, tenus: 0, manquants: [] };
      groupes.set(cle, g);
    }
    g.prevus++;
    const code = codeParEmploye.get(c.employeeId)?.get(iso(c.date)) ?? null;
    if (issueCreneau(code) === "TENU") g.tenus++;
    else g.manquants.push({ employeeId: c.employeeId, code });
  }
  const couverture = [...groupes.values()].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.shiftId.localeCompare(b.shiftId) ||
      a.poste.localeCompare(b.poste),
  );

  // ── Heures par salarié ──────────────────────────────────────────────────────────────────────
  const heures: LigneHeures[] = entrees.employes.map((e) => {
    const codesEmp = codeParEmploye.get(e.id) ?? new Map<string, string>();
    const heuresEmp = heuresParEmploye.get(e.id) ?? new Map<string, number>();
    const creneauxEmp = creneauxParEmploye.get(e.id) ?? new Map<string, CreneauEcart>();

    let heuresPlanifiees = 0;
    let joursTenus = 0;
    for (const c of creneauxEmp.values()) {
      heuresPlanifiees += dureeParShift.get(c.shiftId) ?? 0;
      if (issueCreneau(codesEmp.get(iso(c.date))) === "TENU") joursTenus++;
    }

    // Décision 3 : tout jour codé "P" — planifié ou non — sans heure saisie compte 0 h réalisée et
    // est signalé à part. On ne restreint pas cette recherche aux jours planifiés : un salarié
    // marqué présent un jour hors planning sans heures saisies pose exactement le même problème de
    // saisie que sur un jour planifié.
    let joursPresenceSansHeures = 0;
    for (const [dateIso, code] of codesEmp) {
      if (code !== "P") continue;
      if ((heuresEmp.get(dateIso) ?? 0) === 0) joursPresenceSansHeures++;
    }

    // Décision 4 : un jour est « travaillé » (code "P" ou heures saisies > 0) — les deux sources se
    // complètent, l'IVMS peut alimenter des heures sans code saisi le même jour. Compté hors
    // planning uniquement s'il n'existe AUCUN créneau planifié ce jour-là pour ce salarié.
    const joursTravailles = new Set<string>();
    for (const [dateIso, code] of codesEmp) if (code === "P") joursTravailles.add(dateIso);
    for (const [dateIso, h] of heuresEmp) if (h > 0) joursTravailles.add(dateIso);
    let joursTravaillesHorsPlanning = 0;
    for (const dateIso of joursTravailles) {
      if (!creneauxEmp.has(dateIso)) joursTravaillesHorsPlanning++;
    }

    // Heures réalisées = somme brute des heures saisies sur la période, planifiées ou non — c'est
    // la seule source horaire fiable (décision 3), elle ne dépend pas de la présence d'un créneau.
    let heuresRealisees = 0;
    for (const h of heuresEmp.values()) heuresRealisees += h;

    return {
      employeeId: e.id,
      heuresPlanifiees: arrondi2(heuresPlanifiees),
      heuresRealisees: arrondi2(heuresRealisees),
      ecart: arrondi2(heuresRealisees - heuresPlanifiees),
      joursPlanifies: creneauxEmp.size,
      joursTenus,
      joursTravaillesHorsPlanning,
      joursPresenceSansHeures,
    };
  });

  const creneauxTenus = couverture.reduce((s, g) => s + g.tenus, 0);
  const creneauxAbsents = couverture.reduce(
    (s, g) => s + g.manquants.filter((m) => m.code !== null).length,
    0,
  );
  const creneauxNonRenseignes = couverture.reduce(
    (s, g) => s + g.manquants.filter((m) => m.code === null).length,
    0,
  );

  const total: TotalEcart = {
    creneauxPrevus: creneauxPeriode.length,
    creneauxTenus,
    creneauxAbsents,
    creneauxNonRenseignes,
    heuresPlanifiees: arrondi2(heures.reduce((s, l) => s + l.heuresPlanifiees, 0)),
    heuresRealisees: arrondi2(heures.reduce((s, l) => s + l.heuresRealisees, 0)),
  };

  return { couverture, heures, total };
}
