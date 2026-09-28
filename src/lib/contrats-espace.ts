import "server-only";

import type { Contrat, Prisma } from "@prisma/client";
import { chargerSignatures, etatSignature, type EtatSignature } from "@/lib/signature";
import { classerContrats, type Classement } from "@/lib/contrats-classement";

export type ContratClasse = { contrat: Contrat; etat: EtatSignature; classement: Classement };

/**
 * Les contrats d'UNE fiche, classés (à signer / en vigueur / ancien) — le plus récent d'abord.
 * Deux requêtes (contrats, signatures) plus l'éventuel marquage d'obsolescence de `chargerSignatures`.
 * Lu par « Mes contrats », la pastille de l'accueil, la route de téléchargement et la fiche
 * Direction : tous voient le même classement.
 */
export async function chargerContratsClasses(
  client: Prisma.TransactionClient,
  employeeId: string,
  maintenant: Date = new Date(),
): Promise<ContratClasse[]> {
  const contrats = await client.contrat.findMany({
    where: { employeeId },
    orderBy: [{ dateDebut: "desc" }, { createdAt: "desc" }],
  });
  const sigs = await chargerSignatures(client, "CONTRAT", contrats.map((c) => c.id));
  const etats = new Map(contrats.map((c) => [c.id, etatSignature(sigs.get(c.id))]));
  const classes = classerContrats(contrats, new Map([...etats].map(([id, e]) => [id, e.etat])), maintenant);
  return contrats.map((c) => ({ contrat: c, etat: etats.get(c.id)!, classement: classes.get(c.id)! }));
}
