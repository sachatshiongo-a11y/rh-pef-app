"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";

const dec = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").replace(",", ".").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/** Met à jour le comptage d'un article resto pour une date donnée (upsert ; vide = suppression). */
export async function majComptage(articleRestoId: string, dateISO: string, valeur: string) {
  await garde();
  const date = new Date(dateISO);
  const q = dec(valeur);
  if (q === null) {
    await prisma.comptageResto.deleteMany({ where: { articleRestoId, date } });
  } else {
    await prisma.comptageResto.upsert({
      where: { articleRestoId_date: { articleRestoId, date } },
      update: { quantite: q },
      create: { articleRestoId, date, quantite: q },
    });
  }
  revalidatePath("/stock/restaurant");
}

/** Met à jour le stock de base journalier (niveau cible) d'un article resto. */
export async function majBaseResto(articleRestoId: string, valeur: string) {
  await garde();
  await prisma.articleResto.update({ where: { id: articleRestoId }, data: { stockBaseJournalier: dec(valeur) } });
  revalidatePath("/stock/restaurant");
}

/** Ajoute un article au stock restaurant. */
export async function creerArticleResto(formData: FormData) {
  await garde();
  const espace = String(formData.get("espace") ?? "CUISINE") === "BAR" ? "BAR" : "CUISINE";
  const designation = String(formData.get("designation") ?? "").trim();
  if (!designation) throw new Error("La désignation est requise.");
  const dernier = await prisma.articleResto.aggregate({ where: { espace }, _max: { ordre: true } });
  await prisma.articleResto.create({
    data: {
      espace, designation,
      categorie: String(formData.get("categorie") ?? "").trim() || null,
      unite: String(formData.get("unite") ?? "").trim() || null,
      stockBaseJournalier: dec(formData.get("stockBaseJournalier")),
      ordre: (dernier._max.ordre ?? 0) + 1,
    },
  });
  revalidatePath("/stock/restaurant");
}

/** Modifie un champ d'un article resto (désignation, catégorie, unité, base, ordre). */
export async function modifierArticleResto(id: string, formData: FormData) {
  await garde();
  const data: Record<string, unknown> = {};
  if (formData.has("designation")) {
    const v = String(formData.get("designation") ?? "").trim();
    if (!v) throw new Error("La désignation ne peut pas être vide.");
    data.designation = v;
  }
  if (formData.has("categorie")) data.categorie = String(formData.get("categorie") ?? "").trim() || null;
  if (formData.has("unite")) data.unite = String(formData.get("unite") ?? "").trim() || null;
  if (formData.has("stockBaseJournalier")) data.stockBaseJournalier = dec(formData.get("stockBaseJournalier"));
  if (formData.has("ordre")) { const n = Number(formData.get("ordre")); if (Number.isFinite(n)) data.ordre = Math.trunc(n); }
  await prisma.articleResto.update({ where: { id }, data });
  revalidatePath("/stock/restaurant");
}

/** Supprime un article du stock restaurant (et ses comptages). */
export async function supprimerArticleResto(id: string) {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer
  await prisma.articleResto.delete({ where: { id } });
  revalidatePath("/stock/restaurant");
}
