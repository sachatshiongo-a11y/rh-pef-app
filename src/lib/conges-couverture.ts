import "server-only";
import { prisma } from "@/lib/prisma";
import { pariteSemaine, dureeShift } from "@/app/(app)/planning/creneaux";

/**
 * Jours couverts par un congé APPROUVÉ, pour un lot (employé, date) donné.
 * Renvoie un Set de clés `employeeId|AAAA-MM-JJ` — utilisé par les saisies automatiques
 * (présences / heures en lot) pour ne pas marquer présent ou compter des heures pendant un congé.
 */
export async function joursEnConge(entrees: { employeeId: string; date: string }[]): Promise<Set<string>> {
  if (entrees.length === 0) return new Set();
  const employeeIds = [...new Set(entrees.map((e) => e.employeeId))];
  const dates = entrees.map((e) => e.date).sort();
  const min = new Date(`${dates[0]}T00:00:00.000Z`);
  const max = new Date(`${dates[dates.length - 1]}T00:00:00.000Z`);

  const conges = await prisma.leaveRequest.findMany({
    where: { statut: "APPROUVE", employeeId: { in: employeeIds }, dateDebut: { lte: max }, dateFin: { gte: min } },
    select: { employeeId: true, dateDebut: true, dateFin: true },
  });

  const couverts = new Set<string>();
  for (const e of entrees) {
    const d = new Date(`${e.date}T00:00:00.000Z`);
    if (conges.some((c) => c.employeeId === e.employeeId && d >= new Date(c.dateDebut) && d <= new Date(c.dateFin))) {
      couverts.add(`${e.employeeId}|${e.date}`);
    }
  }
  return couverts;
}

/**
 * Jours de REPOS selon le planning puis le modèle hebdomadaire, pour un lot (employé, date) donné.
 * Renvoie un Set de clés `employeeId|AAAA-MM-JJ` — utilisé par les saisies EN LOT pour ne pas
 * marquer présent / compter des heures un jour où l'employé ne travaille pas (ex. le samedi
 * d'Aimée, que « jours ouvrables » inclurait sinon pour tout le monde).
 * Règles :
 *  — un CRÉNEAU PLANIFIÉ (onglet Planning) prime : shift avec des heures = jour travaillé,
 *    Repos/Congé planifié (shift sans heures) = repos, quel que soit le modèle ;
 *  — sinon, modèle hebdo : un employé SANS AUCUN modèle n'est jamais filtré (comportement
 *    historique conservé) ; résolution par jour identique au pré-remplissage des heures :
 *    couche de la parité (semaine A/B) si présente, sinon couche 0 « chaque semaine » ;
 *    aucune entrée = repos.
 * La saisie UNITAIRE (case par case) reste libre : poser un P exceptionnel un jour de repos
 * est un choix délibéré.
 */
export async function joursDeReposSelonModele(
  entrees: { employeeId: string; date: string }[]
): Promise<Set<string>> {
  if (entrees.length === 0) return new Set();
  const employeeIds = [...new Set(entrees.map((e) => e.employeeId))];
  const dates = entrees.map((e) => e.date).sort();
  const [modeles, creneaux] = await Promise.all([
    prisma.planningModele.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true, jour: true, semaine: true },
    }),
    prisma.planningCreneau.findMany({
      where: {
        employeeId: { in: employeeIds },
        date: { gte: new Date(`${dates[0]}T00:00:00.000Z`), lte: new Date(`${dates[dates.length - 1]}T00:00:00.000Z`) },
      },
      include: { shift: { select: { heureDebut: true, heureFin: true, dureeHeures: true } } },
    }),
  ]);

  const parEmp = new Map<string, Set<string>>(); // employeeId -> clés `${jour}|${semaine}`
  for (const m of modeles) {
    (parEmp.get(m.employeeId) ?? parEmp.set(m.employeeId, new Set()).get(m.employeeId)!).add(
      `${m.jour}|${m.semaine}`
    );
  }
  // Planning explicite : clé `employeeId|date` -> ce jour a-t-il des heures planifiées ?
  const planning = new Map<string, boolean>();
  for (const c of creneaux) {
    const d = dureeShift({
      heureDebut: c.shift.heureDebut,
      heureFin: c.shift.heureFin,
      dureeHeures: c.shift.dureeHeures != null ? Number(c.shift.dureeHeures) : null,
    });
    planning.set(`${c.employeeId}|${new Date(c.date).toISOString().slice(0, 10)}`, d > 0);
  }

  const repos = new Set<string>();
  for (const e of entrees) {
    const cle = `${e.employeeId}|${e.date}`;
    const planifie = planning.get(cle);
    if (planifie !== undefined) {
      if (!planifie) repos.add(cle); // Repos/Congé explicitement planifié
      continue; // shift planifié avec heures : jour travaillé, le modèle ne filtre pas
    }
    const jours = parEmp.get(e.employeeId);
    if (!jours) continue; // aucun modèle défini : on ne filtre pas
    const d = new Date(`${e.date}T00:00:00.000Z`);
    const jour = d.getUTCDay();
    const travaille = jours.has(`${jour}|${pariteSemaine(d)}`) || jours.has(`${jour}|0`);
    if (!travaille) repos.add(cle);
  }
  return repos;
}
