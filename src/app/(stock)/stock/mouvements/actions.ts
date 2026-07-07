"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const dec = (v: FormDataEntryValue): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

/** Sortie de stock (consommation) : décrémente l'inventaire et trace un MouvementStock SORTIE. */
export async function sortieStock(formData: FormData) {
  const user = await verifySession();
  requireModule(user, "stock");

  const ids = formData.getAll("articleId").map(String);
  const qtes = formData.getAll("quantite").map(dec);
  const origine = String(formData.get("origine") ?? "").trim() || "Sortie / consommation";

  const lignes = ids
    .map((articleId, i) => ({ articleId, quantite: qtes[i] ?? 0 }))
    .filter((l) => l.articleId && l.quantite > 0);
  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article + quantité).");

  await prisma.$transaction(async (tx) => {
    for (const l of lignes) {
      await tx.mouvementStock.create({ data: { articleId: l.articleId, type: "SORTIE", quantite: l.quantite, origine, creeParId: user.id } });
      await tx.stock.upsert({
        where: { articleId: l.articleId },
        update: { quantite: { decrement: l.quantite } },
        create: { articleId: l.articleId, quantite: -l.quantite },
      });
    }
  });

  await journaliser(prisma, { entite: "MouvementStock", entiteId: `${lignes.length} sorties`, champ: "sortie", nouvelleValeur: origine, userId: user.id });
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
}
