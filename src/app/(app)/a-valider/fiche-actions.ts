"use server";

import { revalidatePath } from "next/cache";
import { verifySession, requireRole } from "@/lib/auth";
import { approuverDemandesFiche, refuserDemandesFiche, type RapportFiche } from "@/lib/demandes-fiche";

// Décisions de la Direction sur les modifications de fiches salariés (section « À valider »).
// À l'unité comme en lot : une liste d'identifiants ; chaque demande est traitée à part (un échec,
// par exemple une demande périmée, est nommé et ne bloque pas les autres).

function revaliderFiches() {
  revalidatePath("/a-valider");
  revalidatePath("/employes");
  revalidatePath("/paie");
  revalidatePath("/", "layout");
}

export async function approuverModifsFiche(ids: string[]): Promise<RapportFiche> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const r = await approuverDemandesFiche(ids, { id: user.id, nom: user.nom, role: user.role });
  revaliderFiches();
  return r;
}

export async function refuserModifsFiche(ids: string[], motif: string): Promise<RapportFiche> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const r = await refuserDemandesFiche(ids, motif, { id: user.id, nom: user.nom, role: user.role });
  revaliderFiches();
  return r;
}
