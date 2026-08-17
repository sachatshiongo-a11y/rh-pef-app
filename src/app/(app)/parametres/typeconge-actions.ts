"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";

function intOuNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Crée un type de congé/absence paramétrable. joursPayes/tauxPct vides = « À VALIDER ». */
export const creerTypeConge = actionLisible(async (formData: FormData) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du type est requis.");
  const dernier = await prisma.typeConge.findFirst({ orderBy: { ordre: "desc" } });
  await prisma.typeConge.create({
    data: {
      nom,
      joursPayes: intOuNull(formData.get("joursPayes")),
      tauxPct: intOuNull(formData.get("tauxPct")),
      ordre: (dernier?.ordre ?? 0) + 1,
    },
  });
  revalidatePath("/parametres");
  revalidatePath("/conges");
});

/** Modifie un type de congé (nom, jours payés, taux). */
export const modifierTypeConge = actionLisible(async (id: string, formData: FormData) => {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const nom = String(formData.get("nom") ?? "").trim();
  if (!nom) throw new Error("Le nom du type est requis.");
  await prisma.typeConge.update({
    where: { id },
    data: {
      nom,
      joursPayes: intOuNull(formData.get("joursPayes")),
      tauxPct: intOuNull(formData.get("tauxPct")),
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
