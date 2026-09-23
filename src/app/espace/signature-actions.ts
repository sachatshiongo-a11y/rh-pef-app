"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { CibleSignature } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { actionLisible } from "@/lib/action-lisible";
import { documentSignable, decoderTrace } from "@/lib/signature";
import { signerDocument } from "@/lib/signer-document";
import { televerserFichier } from "@/lib/storage";
import { journaliser } from "@/lib/audit";

function pagesConcernees(cible: CibleSignature): string[] {
  switch (cible) {
    case "BULLETIN":
      // Le bouton de signature vit sur « Mes documents » ; l'aperçu du bulletin, sur « Ma paie ».
      return ["/espace/paie", "/espace/documents"];
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
    // Une Server Action est un point d'entrée HTTP indépendant du rendu de page : couper
    // l'interrupteur du self-service (son état par défaut) doit empêcher un appel direct
    // d'écrire une signature, pas seulement masquer le cadre côté page. Même enchaînement que
    // `exigerSalarie` (`src/app/espace/actions.ts`).
    if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");

    const etat = await documentSignable(prisma, cible, cibleId);
    if (!etat.ok) throw new Error(etat.raison);
    if (etat.employeeId !== user.employeeId) throw new Error("Ce document ne vous appartient pas.");

    const buf = decoderTrace(pngDataUrl);
    // CHEMIN UNIQUE PAR SIGNATURE, jamais devinable à partir du document.
    // Le téléversement a lieu AVANT l'écriture en base (qui seule sait si le document est déjà
    // signé) et `televerserFichier` envoie `x-upsert: true` : avec un chemin déterministe
    // `signatures/<cible>/<cibleId>.png`, une tentative REFUSÉE — page restée ouverte, double
    // soumission, appel direct — remplaçait quand même le fichier. Le document aurait alors
    // affiché le tracé du second sous la mention du premier. Le tracé à afficher est celui que la
    // LIGNE de signature désigne (`traceUrl`), et elle seule.
    const traceUrl = await televerserFichier(
      `signatures/${cible.toLowerCase()}/${cibleId}-${randomUUID()}.png`,
      buf,
      "image/png"
    );

    // Signature + (contrat) acceptation, figeage de l'exemplaire et notification de la Direction :
    // le même chemin que la signature en présentiel, cf. `lib/signer-document.ts`.
    await signerDocument({
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

    for (const page of pagesConcernees(cible)) revalidatePath(page);
    revalidatePath("/", "layout");
  }
);
