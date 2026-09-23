import "server-only";

// Le compteur de la semaine pour le Suivi de la Direction (§3 de la conception) : « 3 pointages sur
// 41 sans présence confirmée au restaurant (7 %) ». C'est la mesure qui dira si l'affiche imprimée
// suffit ou s'il faut, plus tard, une tablette à code tournant.
//
// Compté PAR POINTAGE, pas par scan (fix round 1, relecture) : une journée complète (arrivée +
// départ) a DEUX scans mais compte pour UN pointage. Un pointage est « sans présence confirmée » dès
// qu'UN de ses scans est A_VERIFIER — indépendamment de `verifieLe` (mesure de fiabilité de la
// position, pas du travail de vérification restant).
//
// La semaine est TOUJOURS celle qui contient l'instant donné (par défaut « maintenant »), jamais
// celle du jour affiché par le sélecteur de date de la page : c'est un indicateur glissant, pas un
// filtre d'écran. Même découpage lundi→dimanche, en heure de Kinshasa, que le reste du dépôt
// (`lundiDe` de `dates-fr.ts`, déjà utilisé par la paie et le planning) — PAS un second calcul.

import type { PrismaClient } from "@prisma/client";
import { lundiDe } from "@/lib/dates-fr";
import { dateDuJourKinshasa } from "@/lib/pointage-jour";
import { resumePointagesSemaine } from "@/lib/pointage-qr";

/**
 * Bornes lundi 00:00 → dimanche 00:00 (heure de Kinshasa, stockées comme `Pointage.date` : minuit
 * UTC du jour de Kinshasa) de la semaine contenant `maintenant`.
 */
export function bornesSemaineKinshasa(maintenant: Date = new Date()): { debut: Date; fin: Date } {
  const debut = lundiDe(dateDuJourKinshasa(maintenant));
  const fin = new Date(debut);
  fin.setUTCDate(fin.getUTCDate() + 6); // dimanche de la même semaine
  return { debut, fin };
}

/**
 * Combien de POINTAGES de la semaine EN COURS n'ont pas confirmé la présence au restaurant — sur
 * le total de la semaine, jamais sur les autres. Filtré par `Pointage.date` (déjà le jour de
 * Kinshasa), pas par `ScanPointage.instant` : un scan de départ après minuit UTC mais le même jour
 * de Kinshasa reste dans le pointage du jour, donc dans la même semaine. `scans: { some: {} }` :
 * un pointage sans aucun scan (source MANUEL/APP, hors QR) n'entre pas dans la mesure.
 */
export async function resumeSemaineCourante(client: PrismaClient, maintenant: Date = new Date()) {
  const { debut, fin } = bornesSemaineKinshasa(maintenant);
  const pointages = await client.pointage.findMany({
    where: { date: { gte: debut, lte: fin }, scans: { some: {} } },
    select: { scans: { select: { verdict: true } } },
  });
  return resumePointagesSemaine(pointages.map((p) => ({ verdicts: p.scans.map((s) => s.verdict) })));
}
