"use server";

import { revalidatePath } from "next/cache";
import type { TypeAttestation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { actionLisible } from "@/lib/action-lisible";
import { demanderAttestation } from "@/lib/attestations";
import { estTypeAttestation } from "@/lib/attestations-donnees";

/**
 * Le salarié DEMANDE une attestation pour SON dossier. `employeeId` ne vient jamais du navigateur :
 * c'est celui du compte connecté. La Direction délivre (numéro, signature) ou refuse.
 */
export const demanderMonAttestation = actionLisible(async (type: TypeAttestation, motif: string | null): Promise<void> => {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");
  if (!estTypeAttestation(type)) throw new Error("Type d'attestation inconnu.");

  const r = await demanderAttestation(prisma, {
    employeeId: user.employeeId,
    type,
    motif: motif?.slice(0, 200) ?? null,
    parId: user.id,
  });
  if (!r.ok) throw new Error(r.motif);
  revalidatePath("/espace/attestations");
  revalidatePath("/a-valider");
});
