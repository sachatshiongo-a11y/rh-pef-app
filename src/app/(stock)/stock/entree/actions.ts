"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { dec } from "@/lib/nombre";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { cleAlnum } from "@/lib/texte";


/**
 * Liste d'achat → inventaire : chaque ligne (article + quantité) crée un MouvementStock d'ENTRÉE
 * et incrémente le stock de l'article. Une ligne peut viser un article du CATALOGUE ou être en
 * ÉCRITURE LIBRE (nouvel article) : dans ce cas l'article est rapproché par désignation exacte
 * (anti-doublon) ou CRÉÉ automatiquement au catalogue (domaine Nourriture / Boissons / Autre
 * choisi sur la ligne, unité et prix de référence = prix unitaire de cet achat). Transactionnel.
 */
export const entreeListeAchat = actionLisible(async (formData: FormData): Promise<{ crees: string[] }> => {
  const user = await verifySession();
  requireModule(user, "stock");
  await exigerPeriodeOuverte(new Date()); // les entrées sont datées du jour

  const ids = formData.getAll("articleId").map(String);
  const designations = formData.getAll("designation").map((v) => String(v).trim());
  const unites = formData.getAll("unite").map((v) => String(v).trim());
  const domaines = formData.getAll("domaine").map(String);
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
    .map((articleId, i) => ({
      articleId,
      designation: designations[i] ?? "",
      unite: unites[i] ?? "",
      domaine: ["NOURRITURE", "BOISSON", "AUTRE"].includes(domaines[i]) ? (domaines[i] as "NOURRITURE" | "BOISSON" | "AUTRE") : "NOURRITURE",
      quantite: qtes[i] ?? 0,
      montant: montants[i] ?? 0,
    }))
    .filter((l) => (l.articleId || l.designation) && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article du catalogue ou désignation libre, + quantité).");

  // Rapprochement des lignes LIBRES par désignation exacte — on ne crée pas un doublon
  // d'un article déjà au catalogue.
  const existants = await prisma.articleStock.findMany({ select: { id: true, designation: true } });
  const parNom = new Map(existants.map((a) => [cleAlnum(a.designation), a.id]));

  const crees: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const l of lignes) {
      let articleId = l.articleId || null;
      const aMontant = l.montant > 0;
      const montantUSD = aMontant ? (devise === "CDF" ? l.montant / (taux as number) : l.montant) : null;

      if (!articleId) {
        articleId = parNom.get(cleAlnum(l.designation)) ?? null;
        if (!articleId) {
          // Nouvel article : créé au catalogue dans le domaine choisi, avec l'unité saisie et
          // le prix unitaire de CET achat comme prix de référence.
          const prixRef = montantUSD !== null && l.quantite > 0 ? Math.round((montantUSD / l.quantite) * 10000) / 10000 : null;
          const nouveau = await tx.articleStock.create({
            data: { designation: l.designation, unite: l.unite || null, domaine: l.domaine, prixUnitaireUSD: prixRef },
          });
          articleId = nouveau.id;
          parNom.set(cleAlnum(l.designation), nouveau.id);
          crees.push(l.designation);
          await journaliser(tx, { entite: "ArticleStock", entiteId: nouveau.id, champ: "creation", nouvelleValeur: `${l.designation} (auto — liste d'achat, ${l.domaine})`, userId: user.id });
        }
      }

      await tx.mouvementStock.create({
        data: {
          articleId, type: "ENTREE", quantite: l.quantite, origine, creeParId: user.id,
          devise: aMontant ? devise : null,
          montantOrigine: aMontant ? l.montant : null,
          tauxChangeUtilise: aMontant && devise === "CDF" ? taux : null,
          montantUSD,
        },
      });
      await tx.stock.upsert({
        where: { articleId },
        update: { quantite: { increment: l.quantite } },
        create: { articleId, quantite: l.quantite },
      });
    }
  });

  await journaliser(prisma, { entite: "MouvementStock", entiteId: `${lignes.length} entrées`, champ: "entree (liste d'achat)", nouvelleValeur: origine, userId: user.id });
  revalidatePath("/stock/entree");
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock");
  return { crees };
});
