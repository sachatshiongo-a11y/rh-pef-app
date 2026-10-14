import type { Prisma } from "@prisma/client";
import { niveauAlerte } from "@/lib/stock";
import { libellesPrix, prixArticleEnUSD, valeurEnUSD } from "@/lib/prix-article";
import { contenancePourClient } from "@/lib/libelle-article";
import type { ArticleRow } from "./catalogue-table";

/**
 * Ligne de l'Inventaire envoyée au navigateur (2026-10-13, allègement pour les liaisons lentes de Kinshasa).
 *
 * Toute la liste part au navigateur — filtres, tri, compteurs et actions groupées y travaillent sur TOUT
 * le filtre, sans aller-retour —, mais chaque ligne n'emporte que ce que l'écran lit :
 *  - la base ne rend que les colonnes affichées (`CHAMPS_LIGNE_INVENTAIRE`), plus toutes les colonnes de l'article ;
 *  - une valeur PAR DÉFAUT n'est pas écrite : `code`, `prixCDF`, `uniteParCarton`, `haussePct`, `prixAutre`
 *    absents = vides ; `surFicheCommande`, `propositionEnAttente`, `valeurApprox` absents = faux ; `devisePrix`
 *    absent = $ ; `prixEnUSD` (tri de la colonne Prix) n'est écrit que pour un article en francs — en dollars,
 *    le tri lit `prix`. L'écran lisait déjà ces absences comme les valeurs vides (`?? null`, `!= null`, `=== "CDF"`).
 *  - `valeurUSD` est TOUJOURS écrit : null y veut dire « sans prix » (« — »), alors qu'absent ferait recalculer prix × stock.
 */
export const CHAMPS_LIGNE_INVENTAIRE = {
  id: true, actif: true, code: true, designation: true, marque: true, contenance: true, contenanceUnite: true,
  surFicheCommande: true, domaine: true, categorieId: true, fournisseurId: true, unite: true,
  devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, uniteParCarton: true,
  stock: { select: { quantite: true, stockMinimum: true, seuilUrgent: true } },
  _count: { select: { fournisseurs: true } },
} satisfies Prisma.ArticleStockSelect;

export type ArticleInventaire = Prisma.ArticleStockGetPayload<{ select: typeof CHAMPS_LIGNE_INVENTAIRE }>;

export function versLigneInventaire(
  a: ArticleInventaire,
  { hausses, enAttente, taux }: { hausses: ReadonlyMap<string, number>; enAttente: { has(id: string): boolean }; taux: number | null },
): ArticleRow {
  const quantite = a.stock ? Number(a.stock.quantite) : 0;
  const valeur = valeurEnUSD(a, quantite, taux);
  const ligne: ArticleRow = {
    id: a.id,
    designation: a.designation,
    ...contenancePourClient(a), // libellé affiché (désignation + marque + contenance) : `libelleArticle`, côté écran
    domaine: a.domaine,
    categorieId: a.categorieId,
    fournisseurId: a.fournisseurId, // l'HABITUEL (colonne Fournisseur de l'Inventaire)
    nbFournisseurs: a._count.fournisseurs,
    unite: a.unite,
    prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
    valeurUSD: valeur ? valeur.valeur : null,
    quantite: a.stock ? a.stock.quantite.toString() : "0",
    stockMinimum: a.stock ? a.stock.stockMinimum.toString() : "0",
    niveau: a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum, a.stock.seuilUrgent) : null,
  };
  if (!a.actif) ligne.actif = false; // désactivé : masqué de l'Inventaire par défaut, vu par la pastille « Désactivés »
  if (a.code !== null) ligne.code = a.code;
  if (a.surFicheCommande) ligne.surFicheCommande = true;
  // Prix en francs (2026-10-08) : la devise de saisie fait foi, l'autre « ≈ » au taux du jour.
  if (a.devisePrix === "CDF") {
    ligne.devisePrix = "CDF";
    ligne.prixEnUSD = prixArticleEnUSD(a, taux)?.valeur ?? null; // tri de la colonne Prix (un franc se trie à son équivalent du jour)
  }
  if (a.prixUnitaireCDF !== null) ligne.prixCDF = a.prixUnitaireCDF.toString();
  const autre = libellesPrix(a, taux).autre;
  if (autre !== null) ligne.prixAutre = autre;
  if (valeur?.approx) ligne.valeurApprox = true;
  if (a.uniteParCarton !== null) ligne.uniteParCarton = a.uniteParCarton.toString();
  const hausse = hausses.get(a.id);
  if (hausse !== undefined) ligne.haussePct = hausse;
  if (enAttente.has(a.id)) ligne.propositionEnAttente = true;
  return ligne;
}
