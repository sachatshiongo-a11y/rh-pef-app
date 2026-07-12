"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";

/** Enregistre la quantité commandée d'un article pour un jour (0/vide = supprime la ligne). */
export async function saisirCommandeResto(articleId: string, dateIso: string, quantite: number) {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!articleId || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return;
  const date = new Date(dateIso + "T00:00:00Z");
  const q = Number(quantite);
  if (!Number.isFinite(q) || q <= 0) {
    await prisma.commandeResto.deleteMany({ where: { articleId, date } });
  } else {
    await prisma.commandeResto.upsert({
      where: { articleId_date: { articleId, date } },
      update: { quantite: q },
      create: { articleId, date, quantite: q },
    });
  }
  revalidatePath("/stock/journalier");
}

/** Idem pour un légume frais (liste figée, hors catalogue). */
export async function saisirCommandeLegume(legume: string, dateIso: string, quantite: number) {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!legume || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return;
  const date = new Date(dateIso + "T00:00:00Z");
  const q = Number(quantite);
  if (!Number.isFinite(q) || q <= 0) {
    await prisma.commandeLegumeResto.deleteMany({ where: { legume, date } });
  } else {
    await prisma.commandeLegumeResto.upsert({
      where: { legume_date: { legume, date } },
      update: { quantite: q },
      create: { legume, date, quantite: q },
    });
  }
  revalidatePath("/stock/journalier");
}
