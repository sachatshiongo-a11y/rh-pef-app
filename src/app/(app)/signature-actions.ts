"use server";

import { revalidatePath } from "next/cache";
import type { CibleSignature } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { documentSignable, enregistrerSignature, decoderTrace } from "@/lib/signature";
import { televerserFichier } from "@/lib/storage";
import { journaliser } from "@/lib/audit";
import { notifierSalarie, compteSalarieDe } from "@/lib/notifications";

function pagesConcernees(cible: CibleSignature, employeeId: string): string[] {
  switch (cible) {
    case "BULLETIN":
      // La colonne « Signature » est sur Documents & archives et sur la fiche de l'employé ;
      // `revalidatePath("/", "layout")` en fin d'action couvre la fiche (route dynamique).
      return ["/paie", "/documents"];
    case "DEMANDE_CONGE":
      return ["/conges", "/a-valider"];
    case "CONTRAT":
      return [`/employes/${employeeId}`, "/documents"];
  }
}

/**
 * La Direction fait signer un document EN PRÉSENTIEL, sur l'appareil de l'entreprise
 * (mode PRESENTIEL, `presenteParId` = le compte Direction connecté — jamais celui du salarié).
 *
 * Le mode n'est JAMAIS un paramètre de cette action : sa signature ne le porte pas, il est
 * toujours "PRESENTIEL" — décidé ici, jamais par ce qu'un appelant pourrait envoyer.
 *
 * `employeeId` écrit dans la signature vient de `documentSignable` (relu en base), jamais de
 * `user.id` : `user.id` est le compte Direction qui présente l'appareil, il va dans
 * `presenteParId` — jamais dans `employeeId`.
 */
export const faireSignerDocument = actionLisible(
  async (cible: CibleSignature, cibleId: string, pngDataUrl: string): Promise<void> => {
    const user = await verifySession();
    requireRole(user, ["ADMIN", "MANAGER"]);

    const etat = await documentSignable(prisma, cible, cibleId);
    if (!etat.ok) throw new Error(etat.raison);

    const buf = decoderTrace(pngDataUrl);
    const traceUrl = await televerserFichier(`signatures/${cible.toLowerCase()}/${cibleId}.png`, buf, "image/png");

    await enregistrerSignature(prisma, {
      cible,
      cibleId,
      employeeId: etat.employeeId,
      traceUrl,
      mode: "PRESENTIEL",
      presenteParId: user.id,
    });

    await journaliser(prisma, {
      entite: cible,
      entiteId: cibleId,
      champ: "signature",
      nouvelleValeur: "PRESENTIEL",
      userId: user.id,
    });

    const compte = await compteSalarieDe(etat.employeeId);
    if (compte) {
      await notifierSalarie(compte, {
        type: "AUTRE",
        message: `Votre document (${cible}) a été signé.`,
        lien: "/espace",
        refId: `signature:${cible}:${cibleId}`,
      });
    }

    for (const page of pagesConcernees(cible, etat.employeeId)) revalidatePath(page);
    revalidatePath("/", "layout");
  }
);
