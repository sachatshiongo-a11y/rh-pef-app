"use server";

// L'action de vérification en lot du Suivi de la Direction (§3 de la conception) : poser
// `verifieParId`/`verifieLe` sur les scans A_VERIFIER pas encore vérifiés des pointages cochés.
// Réservée à ADMIN et MANAGER (mêmes rôles que la page elle-même). Idempotent : un second appel
// sur les mêmes pointages ne trouve plus rien à vérifier et renvoie `scansVerifies: 0`, sans
// erreur — cocher deux fois par erreur ne doit rien casser.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { actionLisible } from "@/lib/action-lisible";
import { journaliser } from "@/lib/audit";

/**
 * Marque « vérifiés » les scans A_VERIFIER non vérifiés des pointages donnés. Ne touche NI les
 * scans déjà AU_RESTAURANT (rien à vérifier) NI les scans déjà vérifiés (idempotent) — jamais de
 * pointage en dehors de la liste reçue.
 */
export const marquerVerifies = actionLisible(async (pointageIds: string[]): Promise<{ scansVerifies: number }> => {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const ids = [...new Set((pointageIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return { scansVerifies: 0 };

  const maintenant = new Date();
  const scansVerifies = await prisma.$transaction(async (tx) => {
    const aVerifier = await tx.scanPointage.findMany({
      where: { pointageId: { in: ids }, verdict: "A_VERIFIER", verifieLe: null },
      select: { id: true },
    });
    if (aVerifier.length === 0) return 0;

    await tx.scanPointage.updateMany({
      where: { id: { in: aVerifier.map((s) => s.id) } },
      data: { verifieParId: user.id, verifieLe: maintenant },
    });
    for (const s of aVerifier) {
      await journaliser(tx, {
        entite: "ScanPointage",
        entiteId: s.id,
        champ: "verifieLe",
        ancienneValeur: null,
        nouvelleValeur: maintenant.toISOString(),
        userId: user.id,
      });
    }
    return aVerifier.length;
  });

  revalidatePath("/pointer/suivi");
  return { scansVerifies };
});
