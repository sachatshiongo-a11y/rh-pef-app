"use server";

import { revalidatePath } from "next/cache";
import type { TypeAttestation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { actionLisible } from "@/lib/action-lisible";
import { demanderAttestation, delivrerAttestation } from "@/lib/attestations";
import { estTypeAttestation } from "@/lib/attestations-donnees";

/**
 * Le salarié DEMANDE une attestation pour SON dossier. `employeeId` ne vient jamais du navigateur :
 * c'est celui du compte connecté. La Direction délivre (numéro, signature) ou refuse.
 */
export const demanderMonAttestation = actionLisible(async (type: TypeAttestation, motif: string | null): Promise<void> => {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");
  if (!estTypeAttestation(type)) throw new Error("Type d'attestation inconnu.");
  // L'attestation de salaire ne se DEMANDE plus : elle s'obtient tout de suite (ci-dessous).
  if (type === "SALAIRE") throw new Error("L'attestation de salaire s'obtient directement : bouton « Obtenir mon attestation de salaire ».");

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

/**
 * LIBRE-SERVICE (décision Direction 2026-09-28) : le salarié obtient TOUT DE SUITE son attestation de
 * salaire, fondée sur sa dernière paie validée ou payée — même moteur que la Direction
 * (`delivrerAttestation`, verrou, numéro, instantané, exemplaire figé, journal). Une par mois de
 * paie : un second clic rend la même. `employeeId` vient du compte connecté, jamais du navigateur.
 */
export const obtenirMonAttestationSalaire = actionLisible(async (): Promise<{ id: string; numero: string; existante: boolean }> => {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user) || !user.employeeId) throw new Error("Accès refusé.");

  const r = await delivrerAttestation(prisma, { employeeId: user.employeeId, type: "SALAIRE", parId: user.id, libreService: true });
  if (!r.ok) throw new Error(r.motif);
  revalidatePath("/espace/attestations");
  revalidatePath("/attestations");
  revalidatePath(`/employes/${user.employeeId}`);
  return { id: r.id, numero: r.numero, existante: !!r.existante };
});
