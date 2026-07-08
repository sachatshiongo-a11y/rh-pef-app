"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const dec = (v: FormDataEntryValue): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Mouvement de stock manuel (entrée ou sortie), multi-lignes. ENTRÉE incrémente l'inventaire,
 * SORTIE le décrémente. Trace un MouvementStock par ligne.
 */
export async function mouvementManuel(formData: FormData) {
  const user = await verifySession();
  requireModule(user, "stock");

  const type = String(formData.get("type") ?? "SORTIE") === "ENTREE" ? "ENTREE" : "SORTIE";
  const ids = formData.getAll("articleId").map(String);
  const qtes = formData.getAll("quantite").map(dec);
  const origine = String(formData.get("origine") ?? "").trim() || (type === "ENTREE" ? "Entrée manuelle" : "Sortie / consommation");
  const dateStr = String(formData.get("date") ?? "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();

  const lignes = ids
    .map((articleId, i) => ({ articleId, quantite: qtes[i] ?? 0 }))
    .filter((l) => l.articleId && l.quantite > 0);
  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article + quantité).");

  await prisma.$transaction(async (tx) => {
    for (const l of lignes) {
      await tx.mouvementStock.create({ data: { articleId: l.articleId, type, quantite: l.quantite, origine, date, creeParId: user.id } });
      await tx.stock.upsert({
        where: { articleId: l.articleId },
        update: { quantite: type === "ENTREE" ? { increment: l.quantite } : { decrement: l.quantite } },
        create: { articleId: l.articleId, quantite: type === "ENTREE" ? l.quantite : -l.quantite },
      });
    }
  });

  await journaliser(prisma, { entite: "MouvementStock", entiteId: `${lignes.length} ${type.toLowerCase()}(s)`, champ: type.toLowerCase(), nouvelleValeur: origine, userId: user.id });
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
}

/**
 * Supprime un mouvement de stock et ANNULE son effet sur l'inventaire :
 * une ENTRÉE supprimée décrémente le stock, une SORTIE l'incrémente.
 * Un AJUSTEMENT n'enregistre pas son sens → on retire la ligne sans recalculer le stock.
 */
export async function supprimerMouvement(id: string) {
  const user = await verifySession();
  requireModule(user, "stock");

  const m = await prisma.mouvementStock.findUniqueOrThrow({ where: { id } });
  const q = Number(m.quantite);
  await prisma.$transaction(async (tx) => {
    if (m.type === "ENTREE") {
      await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { decrement: q } } });
    } else if (m.type === "SORTIE") {
      await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { increment: q } } });
    }
    await tx.mouvementStock.delete({ where: { id } });
  });

  await journaliser(prisma, { entite: "MouvementStock", entiteId: id, champ: "suppression", ancienneValeur: `${m.type} ${q} (${m.origine ?? ""})`, userId: user.id });
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
}
