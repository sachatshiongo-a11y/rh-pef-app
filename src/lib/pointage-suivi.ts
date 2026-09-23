import "server-only";

// Le compteur de la semaine pour le Suivi de la Direction (§3 de la conception) : « 3 pointages à
// vérifier sur 41 (7 %) ». C'est la mesure qui dira si l'affiche imprimée suffit ou s'il faut, plus
// tard, une tablette à code tournant.
//
// La semaine est TOUJOURS celle qui contient l'instant donné (par défaut « maintenant »), jamais
// celle du jour affiché par le sélecteur de date de la page : c'est un indicateur glissant, pas un
// filtre d'écran. Même découpage lundi→dimanche, en heure de Kinshasa, que le reste du dépôt
// (`lundiDe` de `dates-fr.ts`, déjà utilisé par la paie et le planning) — PAS un second calcul.

import type { PrismaClient } from "@prisma/client";
import { lundiDe } from "@/lib/dates-fr";
import { dateDuJourKinshasa } from "@/lib/pointage-jour";
import { resumeSemaine } from "@/lib/pointage-qr";

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
 * Combien de scans de la semaine EN COURS sont « à vérifier » — sur le total de la semaine,
 * jamais sur les autres. Filtré par `Pointage.date` (déjà le jour de Kinshasa), pas par
 * `ScanPointage.instant` : un scan de départ après minuit UTC mais le même jour de Kinshasa reste
 * dans le pointage du jour, donc dans la même semaine.
 */
export async function resumeSemaineCourante(client: PrismaClient, maintenant: Date = new Date()) {
  const { debut, fin } = bornesSemaineKinshasa(maintenant);
  const scans = await client.scanPointage.findMany({
    where: { pointage: { date: { gte: debut, lte: fin } } },
    select: { verdict: true },
  });
  return resumeSemaine(scans);
}
