"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { decSaisiOptionnel } from "@/lib/nombre";

/** Entier facultatif d'un champ (vide = « À VALIDER »). Illisible, décimal ou hors bornes : refusé, jamais arrondi. */
function entierOuNull(v: FormDataEntryValue | null, libelle: string, max?: number): number | null {
  const n = decSaisiOptionnel(v, libelle);
  if (n === null) return null;
  if (!Number.isInteger(n) || n < 0 || (max !== undefined && n > max)) {
    throw new Error(`${libelle} : un nombre entier${max !== undefined ? ` de 0 à ${max}` : " positif"} est attendu (« ${String(v).trim()} » refusé).`);
  }
  return n;
}

/** Crée un type de congé/absence paramétrable. joursPayes/tauxPct vides = « À VALIDER » et la case
 * « compte dans le solde » (seuls les types cochés se déduisent du solde de congé annuel). */
export const creerTypeConge = actionLisible(async (formData: FormData) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du type est requis.");
  const dernier = await prisma.typeConge.findFirst({ orderBy: { ordre: "desc" } });
  await prisma.typeConge.create({
    data: {
      nom,
      joursPayes: entierOuNull(formData.get("joursPayes"), "Jours payés"),
      tauxPct: entierOuNull(formData.get("tauxPct"), "Taux %"),
      compteDansSolde: formData.get("compteDansSolde") === "on",
      ordre: (dernier?.ordre ?? 0) + 1,
    },
  });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});

/** Modifie un type de congé (nom, jours payés, taux, case « compte dans le solde »). */
export const modifierTypeConge = actionLisible(async (id: string, formData: FormData) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du type est requis.");
  await prisma.typeConge.update({
    where: { id },
    data: {
      nom,
      joursPayes: entierOuNull(formData.get("joursPayes"), "Jours payés"),
      tauxPct: entierOuNull(formData.get("tauxPct"), "Taux %"),
      compteDansSolde: formData.get("compteDansSolde") === "on",
    },
  });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});

/** Active / désactive un type (un type inactif n'apparaît plus dans le menu des congés). */
export const basculerTypeConge = actionLisible(async (id: string) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const t = await prisma.typeConge.findUniqueOrThrow({ where: { id } });
  await prisma.typeConge.update({ where: { id }, data: { actif: !t.actif } });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});

/** Supprime un type non système (les types système ne sont pas supprimables). */
export const supprimerTypeConge = actionLisible(async (id: string) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const t = await prisma.typeConge.findUniqueOrThrow({ where: { id } });
  if (t.systeme) throw new Error("Ce type système ne peut pas être supprimé (désactivez-le).");
  await prisma.typeConge.delete({ where: { id } });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});
