import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type DomaineFiche = "NOURRITURE" | "BOISSON" | "AUTRE";

/** `?domaine=` brut → domaine de la fiche (toute valeur inconnue = tous les domaines). */
export const domaineDeFiche = (v: string | null): DomaineFiche | undefined => (v === "NOURRITURE" || v === "BOISSON" || v === "AUTRE" ? v : undefined);

/**
 * Les articles d'une fiche de comptage vierge — UNE seule lecture pour la fiche Excel et la fiche PDF : mêmes
 * articles (actifs, du domaine), même ordre (domaine, catégorie, désignation), pour que les deux disent la même chose.
 */
export function chargerArticlesFiche(domaine: DomaineFiche | undefined, q = "") {
  const where: Prisma.ArticleStockWhereInput = {
    actif: true,
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  return prisma.articleStock.findMany({
    where,
    orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }],
    include: { stock: { select: { quantite: true } }, categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } } },
  });
}
