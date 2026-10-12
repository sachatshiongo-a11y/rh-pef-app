import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { libelleArticle } from "@/lib/libelle-article";
import type { FicheDispo } from "@/lib/fiches/disponibilite";
import { consommationDesVentes, type ArticleVente, type ConsommationDesVentes, type VenteSR } from "@/lib/ventes-consommation";

// Chargement GROUPÉ de la consommation théorique des ventes (jamais une requête par fiche ni par article) :
//   1. les ventes saisies dans la fenêtre (`VenteJournaliere`, dates PURES) ;
//   2. les fiches techniques (lignes comprises) — les sous-recettes se résolvent depuis ce même jeu ;
//   3. les articles du catalogue qu'elles utilisent (unité, contenance, domaine).
// Lecture seule. Rien n'est lu si aucune vente n'est saisie dans la fenêtre.

const jourPur = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Ventes de `]apres, jusquA]` (AAAA-MM-JJ, `apres` exclu : le comptage de fin de journée contient ses ventes). */
export async function chargerVentesEtConsommation({ apres, jusquA, client = prisma }: { apres: string; jusquA: string; client?: Pick<typeof prisma, "venteJournaliere" | "ficheTechnique" | "articleStock"> }): Promise<ConsommationDesVentes & { ventes: VenteSR[] }> {
  const lignesVentes = await client.venteJournaliere.findMany({
    where: { date: { gt: jourPur(apres), lte: jourPur(jusquA) }, quantite: { gt: 0 } },
    select: { date: true, ficheId: true, quantite: true },
  });
  if (lignesVentes.length === 0) return { conso: [], aVerifier: [], ventes: [] };
  const ventes: VenteSR[] = lignesVentes.map((v) => ({ date: iso(v.date), ficheId: v.ficheId, quantite: v.quantite }));

  const fiches = await client.ficheTechnique.findMany({
    select: {
      id: true, nom: true, nbPortions: true, estSousRecette: true, rendementQuantite: true, rendementUnite: true,
      ingredients: { orderBy: { ordre: "asc" }, select: { articleId: true, sousFicheId: true, unite: true, quantite: true } },
    },
  } satisfies Prisma.FicheTechniqueFindManyArgs);
  const idsArticles = [...new Set(fiches.flatMap((f) => f.ingredients.flatMap((i) => (i.articleId ? [i.articleId] : []))))];
  const articles = idsArticles.length === 0 ? [] : await client.articleStock.findMany({
    where: { id: { in: idsArticles } },
    select: { id: true, designation: true, marque: true, unite: true, contenance: true, contenanceUnite: true, domaine: true },
  });
  const parId = new Map<string, ArticleVente>(articles.map((a) => [a.id, {
    id: a.id, designation: libelleArticle(a), marque: a.marque, unite: a.unite ?? "",
    contenance: a.contenance?.toString() ?? null, contenanceUnite: a.contenanceUnite, domaine: a.domaine,
  }]));
  const nomFiche = new Map(fiches.map((f) => [f.id, f.nom]));
  const dispo = new Map<string, FicheDispo>(fiches.map((f) => [f.id, {
    id: f.id, nom: f.nom, nbPortions: f.nbPortions, estSousRecette: f.estSousRecette,
    rendementQuantite: f.rendementQuantite?.toString() ?? null, rendementUnite: f.rendementUnite,
    ingredients: f.ingredients.map((i, k) => ({
      nom: i.articleId ? (parId.get(i.articleId)?.designation ?? "Article supprimé du catalogue") : i.sousFicheId ? (nomFiche.get(i.sousFicheId) ?? "Sous-recette introuvable") : `Ingrédient n°${k + 1}`,
      unite: i.unite, quantite: i.quantite.toString(), articleId: i.articleId, sousFicheId: i.sousFicheId,
    })),
  }]));
  return { ...consommationDesVentes(ventes, dispo, parId), ventes };
}
