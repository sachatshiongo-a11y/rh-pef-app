"use server";

import { revalidatePath } from "next/cache";
import { verifySession, requireRole } from "@/lib/auth";
import { approuverDemandesFiche, refuserDemandesFiche, type RapportFiche } from "@/lib/demandes-fiche";
import { approuverCreations, idsDemandesCreation, refuserCreations } from "@/lib/creation-fiche";

// Décisions de la Direction sur les modifications de fiches salariés (section « À valider »).
// À l'unité comme en lot : une liste d'identifiants ; chaque demande est traitée à part (un échec,
// par exemple une demande périmée, est nommé et ne bloque pas les autres).

const vide = (): RapportFiche => ({ traitees: 0, echecs: [], avertissements: [] });
const fusionner = (a: RapportFiche, b: RapportFiche): RapportFiche => ({
  traitees: a.traitees + b.traitees, echecs: [...a.echecs, ...b.echecs], avertissements: [...a.avertissements, ...b.avertissements],
});

function revaliderFiches() {
  revalidatePath("/a-valider");
  revalidatePath("/employes");
  revalidatePath("/paie");
  revalidatePath("/", "layout");
}

export async function approuverModifsFiche(ids: string[]): Promise<RapportFiche> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const acteur = { id: user.id, nom: user.nom, role: user.role };
  // Mélange possible de modifications de fiches ET de créations de fiches (même section « À valider »).
  const creations = await idsDemandesCreation(ids);
  const [a, b] = [
    await approuverDemandesFiche(ids.filter((i) => !creations.has(i)), acteur),
    await approuverCreations(ids.filter((i) => creations.has(i)), acteur),
  ];
  revaliderFiches();
  return fusionner(a, b);
}

export async function refuserModifsFiche(ids: string[], motif: string): Promise<RapportFiche> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const acteur = { id: user.id, nom: user.nom, role: user.role };
  const creations = await idsDemandesCreation(ids);
  const mod = ids.filter((i) => !creations.has(i)), cre = ids.filter((i) => creations.has(i));
  const a = mod.length > 0 || cre.length === 0 ? await refuserDemandesFiche(mod, motif, acteur) : vide();
  const b = cre.length > 0 ? await refuserCreations(cre, motif, acteur) : vide();
  revaliderFiches();
  return fusionner(a, b);
}
