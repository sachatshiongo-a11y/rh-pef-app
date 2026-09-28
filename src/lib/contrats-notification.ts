import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerSignature, etatSignature, type EtatSignature } from "@/lib/signature";
import { compteSalarieDe, notifierSalarie } from "@/lib/notifications";
import { chargerContratsClasses } from "@/lib/contrats-espace";

// UN CONTRAT ATTEND LA SIGNATURE DU SALARIÉ (spec 2026-09-28, §3.3).
//
// Deux déclencheurs : la création d'un contrat, et une modification qui fait repasser un contrat
// SIGNÉ en « à resigner » (l'empreinte des conditions a changé). Un contrat jamais signé qu'on
// corrige n'est pas un nouvel événement : le salarié a déjà été prévenu à sa création.
//
// Même canal que les autres événements du salarié (`notifierSalarie` : cloche de l'espace + push).
// Un salarié sans compte actif n'est pas notifié — il n'a pas d'espace où signer.
//
// Jamais bloquant : la Direction vient d'enregistrer un contrat, une panne de push ne doit pas le
// faire échouer après coup.

export const MESSAGE_CONTRAT_A_SIGNER = "Un contrat vous attend pour signature";

export async function notifierContratASigner(contratId: string): Promise<void> {
  try {
    const contrat = await prisma.contrat.findUnique({ where: { id: contratId }, select: { employeeId: true } });
    if (!contrat) return;
    // Seulement si le contrat est À SIGNER au sens de « Mes contrats » (`classerContrats`) : un
    // contrat saisi a posteriori et déjà échu, ou plus ancien qu'un contrat actif (« remplacé »),
    // ne s'y signe pas — la cloche annoncerait un geste impossible.
    const classes = await chargerContratsClasses(prisma, contrat.employeeId);
    if (classes.find((c) => c.contrat.id === contratId)?.classement.categorie !== "A_SIGNER") return;
    const userId = await compteSalarieDe(contrat.employeeId);
    if (!userId) return;
    await notifierSalarie(userId, {
      type: "AUTRE",
      message: MESSAGE_CONTRAT_A_SIGNER,
      lien: "/espace/contrats",
      // L'instant dans la clé : une nouvelle version à resigner est un nouvel événement.
      refId: `contrat:${contratId}:a-signer:${Date.now()}`,
    });
  } catch {
    // La notification est un confort : le contrat, lui, est enregistré.
  }
}

/** État de signature ACTUEL d'un contrat (relu, obsolescence détectée et persistée). */
export async function etatSignatureContrat(contratId: string): Promise<EtatSignature["etat"]> {
  return etatSignature(await chargerSignature(prisma, "CONTRAT", contratId)).etat;
}

/**
 * À appeler APRÈS une modification des conditions d'un contrat, avec l'état relu AVANT : prévient
 * le salarié seulement si le contrat était signé et ne l'est plus (passage « à resigner »).
 */
export async function notifierSiContratARevoir(contratId: string, avant: EtatSignature["etat"]): Promise<void> {
  if (avant !== "SIGNE") return;
  const apres = await etatSignatureContrat(contratId);
  if (apres === "A_RESIGNER") await notifierContratASigner(contratId);
}
