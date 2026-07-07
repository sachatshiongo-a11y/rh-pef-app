"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

/**
 * Applique un comptage physique : pour chaque article compté, calcule l'écart avec le stock
 * théorique, crée un MouvementStock d'AJUSTEMENT et fixe le stock à la valeur réelle comptée.
 * Seules les lignes où une quantité physique a été saisie sont traitées.
 */
export async function appliquerComptage(formData: FormData) {
  const user = await verifySession();
  requireModule(user, "stock");

  const ids = formData.getAll("recon_articleId").map(String);
  const phys = formData.getAll("recon_physique").map((v) => String(v).trim());
  const origine = String(formData.get("origine") ?? "").trim() || `Réconciliation ${new Date().toLocaleDateString("fr-FR")}`;

  const comptes = ids
    .map((articleId, i) => ({ articleId, physique: phys[i] }))
    .filter((c) => c.articleId && c.physique !== "" && Number.isFinite(Number(c.physique.replace(",", "."))))
    .map((c) => ({ articleId: c.articleId, physique: Number(c.physique.replace(",", ".")) }));

  if (comptes.length === 0) throw new Error("Saisissez au moins un comptage physique.");

  const stocks = await prisma.stock.findMany({ where: { articleId: { in: comptes.map((c) => c.articleId) } } });
  const theo = new Map(stocks.map((s) => [s.articleId, Number(s.quantite)]));

  let nbAjust = 0;
  await prisma.$transaction(async (tx) => {
    for (const c of comptes) {
      const t = theo.get(c.articleId) ?? 0;
      const ecart = c.physique - t;
      if (Math.abs(ecart) > 0.0001) {
        await tx.mouvementStock.create({
          data: { articleId: c.articleId, type: "AJUSTEMENT", quantite: Math.abs(ecart), origine, creeParId: user.id },
        });
        nbAjust++;
      }
      await tx.stock.upsert({
        where: { articleId: c.articleId },
        update: { quantite: c.physique },
        create: { articleId: c.articleId, quantite: c.physique },
      });
    }
  });

  await journaliser(prisma, { entite: "Stock", entiteId: `${comptes.length} articles`, champ: "reconciliation", nouvelleValeur: `${nbAjust} ajustement(s) — ${origine}`, userId: user.id });
  revalidatePath("/stock/reconciliation");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
}
