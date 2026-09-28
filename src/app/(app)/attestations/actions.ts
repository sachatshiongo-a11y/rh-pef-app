"use server";

import { revalidatePath } from "next/cache";
import type { TypeAttestation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { delivrerAttestation, refuserAttestation } from "@/lib/attestations";
import { estTypeAttestation } from "@/lib/attestations-donnees";

// DÉLIVRER / REFUSER une attestation — geste de la Direction (ADMIN), comme la validation des
// bulletins et des congés dans « Demandes de validation ». Chaque ligne est traitée seule : une
// demande inéligible ou déjà traitée n'empêche pas les autres, et revient avec SON message.

export type ResultatLotAttestations = { traites: number; refus: { id: string; nom: string; message: string }[] };

async function exigerDirection() {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  return user;
}

function revalider(employeeIds: string[]) {
  revalidatePath("/a-valider");
  revalidatePath("/documents");
  for (const e of new Set(employeeIds)) revalidatePath(`/employes/${e}`);
}

async function nomsDe(ids: string[]) {
  const lignes = await prisma.attestation.findMany({ where: { id: { in: ids } }, select: { id: true, employeeId: true, employee: { select: { nom: true } } } });
  return new Map(lignes.map((l) => [l.id, { nom: l.employee.nom, employeeId: l.employeeId }]));
}

export const delivrerAttestations = actionLisible(async (ids: string[]): Promise<ResultatLotAttestations> => {
  const user = await exigerDirection();
  const noms = await nomsDe(ids);
  const r: ResultatLotAttestations = { traites: 0, refus: [] };
  // Une à une : chaque délivrance a SA transaction (numéro, instantané, journal).
  for (const id of ids) {
    const res = await delivrerAttestation(prisma, { attestationId: id, parId: user.id });
    if (res.ok) r.traites++;
    else r.refus.push({ id, nom: noms.get(id)?.nom ?? "—", message: res.motif });
  }
  revalider([...noms.values()].map((n) => n.employeeId));
  return r;
});

export const refuserAttestations = actionLisible(async (ids: string[], motif: string): Promise<ResultatLotAttestations> => {
  const user = await exigerDirection();
  if (!motif.trim()) throw new Error("Indiquez le motif du refus.");
  const noms = await nomsDe(ids);
  const r: ResultatLotAttestations = { traites: 0, refus: [] };
  for (const id of ids) {
    const res = await refuserAttestation(prisma, { id, motif: motif.slice(0, 300), parId: user.id });
    if (res.ok) r.traites++;
    else r.refus.push({ id, nom: noms.get(id)?.nom ?? "—", message: res.motif });
  }
  revalider([...noms.values()].map((n) => n.employeeId));
  return r;
});

/**
 * « Délivrer une attestation » depuis la fiche : crée une attestation DÉJÀ délivrée et numérotée
 * (ou satisfait la demande du même type en attente), prête à télécharger.
 */
export const delivrerAttestationDirecte = actionLisible(
  async (employeeId: string, type: TypeAttestation): Promise<{ id: string; numero: string }> => {
    const user = await exigerDirection();
    if (!estTypeAttestation(type)) throw new Error("Type d'attestation inconnu.");
    const res = await delivrerAttestation(prisma, { employeeId, type, parId: user.id });
    if (!res.ok) throw new Error(res.motif);
    revalider([employeeId]);
    return { id: res.id, numero: res.numero };
  },
);
