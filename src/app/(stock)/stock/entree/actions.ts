"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

/** Supprime TOUTES les entrées de la liste d'achat (ENTREE hors facture) et annule leur effet sur le stock. */
export async function supprimerToutesEntreesAchat() {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  const mvts = await prisma.mouvementStock.findMany({ where: { type: "ENTREE", factureId: null }, select: { id: true, articleId: true, quantite: true } });
  await prisma.$transaction(async (tx) => {
    for (const m of mvts) await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { decrement: Number(m.quantite) } } });
    await tx.mouvementStock.deleteMany({ where: { id: { in: mvts.map((m) => m.id) } } });
  });
  await journaliser(prisma, { entite: "MouvementStock", entiteId: "liste d'achat", champ: "suppression groupée", nouvelleValeur: `${mvts.length} entrée(s)`, userId: user.id });
  revalidatePath("/stock/entree");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
}

const dec = (v: FormDataEntryValue): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Liste d'achat → inventaire : chaque ligne (article + quantité) crée un MouvementStock d'ENTRÉE
 * et incrémente le stock de l'article. Tout est appliqué dans une transaction.
 */
export async function entreeListeAchat(formData: FormData) {
  const user = await verifySession();
  requireModule(user, "stock");

  const ids = formData.getAll("articleId").map(String);
  const qtes = formData.getAll("quantite").map(dec);
  const montants = formData.getAll("montant").map(dec); // montant payé par ligne (facultatif)
  const devise = String(formData.get("devise") ?? "USD") === "CDF" ? "CDF" : "USD";
  const origine = String(formData.get("origine") ?? "").trim() || "Liste d'achat";

  // Taux CDF/USD partagé avec la RH (Config) — utilisé pour convertir un achat en francs.
  let taux: number | null = null;
  if (devise === "CDF") {
    const config = await prisma.config.findUnique({ where: { id: "singleton" } });
    taux = config ? Number(config.tauxChangeCDF) : null;
    if (!taux) throw new Error("Taux de change CDF/USD non défini (Config).");
  }

  const lignes = ids
    .map((articleId, i) => ({ articleId, quantite: qtes[i] ?? 0, montant: montants[i] ?? 0 }))
    .filter((l) => l.articleId && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article + quantité).");

  await prisma.$transaction(async (tx) => {
    for (const l of lignes) {
      const aMontant = l.montant > 0;
      const montantUSD = aMontant ? (devise === "CDF" ? l.montant / (taux as number) : l.montant) : null;
      await tx.mouvementStock.create({
        data: {
          articleId: l.articleId, type: "ENTREE", quantite: l.quantite, origine, creeParId: user.id,
          devise: aMontant ? devise : null,
          montantOrigine: aMontant ? l.montant : null,
          tauxChangeUtilise: aMontant && devise === "CDF" ? taux : null,
          montantUSD,
        },
      });
      await tx.stock.upsert({
        where: { articleId: l.articleId },
        update: { quantite: { increment: l.quantite } },
        create: { articleId: l.articleId, quantite: l.quantite },
      });
    }
  });

  await journaliser(prisma, { entite: "MouvementStock", entiteId: `${lignes.length} entrées`, champ: "entree (liste d'achat)", nouvelleValeur: origine, userId: user.id });
  revalidatePath("/stock/entree");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock");
}
