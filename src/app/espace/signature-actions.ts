"use server";

import { revalidatePath } from "next/cache";
import type { CibleSignature } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { documentSignable, enregistrerSignature, decoderTrace } from "@/lib/signature";
import { televerserFichier } from "@/lib/storage";
import { journaliser } from "@/lib/audit";
import { creerNotification } from "@/lib/notifications";

function pagesConcernees(cible: CibleSignature): string[] {
  switch (cible) {
    case "BULLETIN":
      return ["/espace/paie"];
    case "DEMANDE_CONGE":
      return ["/espace/conges"];
    case "CONTRAT":
      return ["/espace/documents"];
  }
}

/**
 * Le salarié signe SON document depuis son espace, seul (mode ESPACE_SALARIE) — jamais présenté
 * par la Direction. `presenteParId` est toujours `null` : personne n'accompagne ce geste.
 *
 * GARDE CRITIQUE : `enregistrerSignature` fait confiance à l'`employeeId` qu'on lui passe — rien à
 * ce niveau n'empêche d'attribuer le document d'un salarié à un autre. C'est ICI que le trou se
 * ferme : `employeeId` ne vient JAMAIS d'une donnée envoyée par le navigateur (le client n'en
 * fournit d'ailleurs aucun — seuls `cible` et `cibleId` transitent). On relit le document en base
 * via `documentSignable`, qui renvoie SON `employeeId` réel, et on le compare au compte connecté
 * AVANT d'écrire quoi que ce soit. Un salarié qui appelle cette action sur le document d'un
 * collègue est refusé ici, pas plus tard.
 */
export const signerMonDocument = actionLisible(
  async (cible: CibleSignature, cibleId: string, pngDataUrl: string): Promise<void> => {
    const user = await verifySession();
    if (!estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");

    const etat = await documentSignable(prisma, cible, cibleId);
    if (!etat.ok) throw new Error(etat.raison);
    if (etat.employeeId !== user.employeeId) throw new Error("Ce document ne vous appartient pas.");

    const buf = decoderTrace(pngDataUrl);
    const traceUrl = await televerserFichier(`signatures/${cible.toLowerCase()}/${cibleId}.png`, buf, "image/png");

    await enregistrerSignature(prisma, {
      cible,
      cibleId,
      employeeId: etat.employeeId,
      traceUrl,
      mode: "ESPACE_SALARIE",
      presenteParId: null,
    });

    await journaliser(prisma, {
      entite: cible,
      entiteId: cibleId,
      champ: "signature",
      nouvelleValeur: "ESPACE_SALARIE",
      userId: user.id,
    });

    const emp = await prisma.employee.findUnique({ where: { id: etat.employeeId }, select: { nom: true } });
    await creerNotification({
      type: "AUTRE",
      message: `${emp?.nom ?? "Un salarié"} a signé son document (${cible}) depuis son espace.`,
      lien: "/a-valider",
      refId: `signature:${cible}:${cibleId}`,
    });

    for (const page of pagesConcernees(cible)) revalidatePath(page);
    revalidatePath("/", "layout");
  }
);
