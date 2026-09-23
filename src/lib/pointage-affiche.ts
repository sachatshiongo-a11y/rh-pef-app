import "server-only";

// Le CODE de l'affiche à imprimer — serveur. L'affiche n'a de sens qu'avec la position du
// restaurant : sans elle, `enregistrerScan` refuse chaque scan (rien à quoi comparer). On refuse
// donc d'imprimer — et de changer le code — tant qu'elle n'est pas réglée.

import type { Prisma, PrismaClient } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { genererCodeAffiche } from "@/lib/pointage-code";
import { MESSAGE_POSITION_NON_REGLEE } from "@/lib/pointage-qr";

export { MESSAGE_POSITION_NON_REGLEE };

type Client = PrismaClient | Prisma.TransactionClient;

/** Lève `MESSAGE_POSITION_NON_REGLEE` si la position du restaurant n'est pas réglée ; renvoie le code actuel. */
export async function exigerPositionReglee(client: Client): Promise<{ code: string | null }> {
  const c = await client.config.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { pointageLatitude: true, pointageLongitude: true, pointageCode: true },
  });
  if (c.pointageLatitude === null || c.pointageLongitude === null) throw new Error(MESSAGE_POSITION_NON_REGLEE);
  return { code: c.pointageCode };
}

/**
 * Le code à imprimer : le code EN VIGUEUR (réimprimer ne rend pas les affiches déjà collées
 * inutilisables — c'est le rôle de « Changer le code »), ou, s'il n'y en a aucun, un nouveau.
 * L'écriture est conditionnelle (`pointageCode` encore nul) : deux impressions simultanées ne
 * créent qu'un code, et toutes deux impriment celui-là.
 *
 * La création du code et sa ligne au journal sont dans UNE transaction : pas de code créé sans
 * trace de son auteur (`auteurId` est donc obligatoire), comme `changerCodeAffiche`.
 */
export async function codeAfficheAImprimer(client: PrismaClient, auteurId: string): Promise<string> {
  return client.$transaction(async (tx) => {
    const { code } = await exigerPositionReglee(tx);
    if (code) return code;
    const cree = await tx.config.updateMany({
      where: { id: "singleton", pointageCode: null },
      data: { pointageCode: genererCodeAffiche() },
    });
    if (cree.count === 1) {
      // Le code est un secret : il n'est JAMAIS écrit au journal, seulement l'événement.
      await journaliser(tx, {
        entite: "Config", entiteId: "singleton", champ: "pointageCode",
        ancienneValeur: "aucun", nouvelleValeur: "code créé à la première impression de l'affiche", userId: auteurId,
      });
    }
    // Perdant d'une impression simultanée : `updateMany` a attendu la fin de la transaction du
    // gagnant (verrou de ligne) puis n'a rien écrit ; cette relecture voit le code qu'il a créé.
    const relu = await tx.config.findUniqueOrThrow({ where: { id: "singleton" }, select: { pointageCode: true } });
    if (!relu.pointageCode) throw new Error("Le code de l'affiche n'a pas pu être créé. Réessayez.");
    return relu.pointageCode;
  });
}
