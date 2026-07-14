import "server-only";
import { prisma } from "@/lib/prisma";
import { pariteSemaine } from "@/app/(app)/planning/creneaux";

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
 * Jours de REPOS selon le modèle hebdomadaire, pour un lot (employé, date) donné.
 * Renvoie un Set de clés `employeeId|AAAA-MM-JJ` — utilisé par les saisies EN LOT pour ne pas
 * marquer présent / compter des heures un jour où le modèle dit repos (ex. le samedi d'Aimée,
 * que « jours ouvrables » inclurait sinon pour tout le monde).
 * Règles :
 *  — un employé SANS AUCUN modèle n'est jamais filtré (comportement historique conservé) ;
 *  — résolution par jour identique au pré-remplissage des heures : couche de la parité
 *    (semaine A/B) si présente, sinon couche 0 « chaque semaine » ; aucune entrée = repos.
 * La saisie UNITAIRE (case par case) reste libre : poser un P exceptionnel un jour de repos
 * est un choix délibéré.
 */
export async function joursDeReposSelonModele(
  entrees: { employeeId: string; date: string }[]
): Promise<Set<string>> {
  if (entrees.length === 0) return new Set();
  const employeeIds = [...new Set(entrees.map((e) => e.employeeId))];
  const modeles = await prisma.planningModele.findMany({
    where: { employeeId: { in: employeeIds } },
    select: { employeeId: true, jour: true, semaine: true },
  });

  const parEmp = new Map<string, Set<string>>(); // employeeId -> clés `${jour}|${semaine}`
  for (const m of modeles) {
    (parEmp.get(m.employeeId) ?? parEmp.set(m.employeeId, new Set()).get(m.employeeId)!).add(
      `${m.jour}|${m.semaine}`
    );
  }

  const repos = new Set<string>();
  for (const e of entrees) {
    const jours = parEmp.get(e.employeeId);
    if (!jours) continue; // aucun modèle défini : on ne filtre pas
    const d = new Date(`${e.date}T00:00:00.000Z`);
    const jour = d.getUTCDay();
    const travaille = jours.has(`${jour}|${pariteSemaine(d)}`) || jours.has(`${jour}|0`);
    if (!travaille) repos.add(`${e.employeeId}|${e.date}`);
  }
  return repos;
}
