import type { Prisma } from "@prisma/client";
import { MOIS_FR } from "@/lib/dates-fr";
import { WHERE_ACHATS_LISTE } from "@/lib/achats-liste";

// Filtre de l'écran Stock → Mouvements (mois, produit, motif), UNE SEULE construction du `where`
// pour la page qui affiche et pour les actions groupées « tout le filtre » qui écrivent
// (décision du 2026-09-29) : si l'une changeait sans l'autre, l'action frapperait un ensemble
// différent de celui que la Direction a vu et confirmé.

/** L'écran n'affiche que les N mouvements les plus récents du filtre. */
export const PLAFOND_AFFICHAGE = 600;
/** Au-delà, une action « tout le filtre » refuse et invite à affiner (une transaction raisonnable). */
export const BORNE_TOUT_LE_FILTRE = 5000;

/**
 * Filtre « motif » :
 * - SORTIES : requalification des sorties importées sans motif ;
 * - ENTRÉES (2026-09-30) : les catégories des cartes d'indicateurs « Entrées de stock »
 *   (`lib/indicateurs/entrees-stock.ts`). Chaque carte compte EXACTEMENT l'ensemble que son lien
 *   affiche : les deux lisent ce `where`. Les trois catégories (Liste d'achat, factures, autres)
 *   partagent les entrées sans reste ni recouvrement : « autres » est le complément des deux
 *   premières (une facture d'abord ; sinon la règle de la Liste d'achat, `WHERE_ACHATS_LISTE`).
 *   Un AJUSTEMENT d'inventaire n'est pas une entrée : son sens n'est pas enregistré.
 */
export const FILTRES_MOTIF = {
  livraison: { label: "Sorties : Livraison restaurant", libelle: "motif Livraison restaurant", where: { type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT" } },
  perte: { label: "Sorties : Perte", libelle: "motif Perte", where: { type: "SORTIE", categorieSortie: "PERTE" } },
  sans: { label: "Sorties : sans motif", libelle: "sans motif", where: { type: "SORTIE", categorieSortie: null } },
  entrees: { label: "Entrées : toutes (hors ajustements)", libelle: "toutes les entrées", where: { type: "ENTREE" } },
  achats: { label: "Entrées : Liste d'achat", libelle: "entrées de la Liste d'achat", where: WHERE_ACHATS_LISTE },
  factures: { label: "Entrées : factures fournisseurs", libelle: "entrées par facture fournisseur", where: { type: "ENTREE", factureId: { not: null } } },
  autres: { label: "Entrées : autres (réceptions, manuelles, corrections, imports)", libelle: "autres entrées", where: { AND: [{ type: "ENTREE", factureId: null }, { NOT: WHERE_ACHATS_LISTE }] } },
} as const satisfies Record<string, { label: string; libelle: string; where: Prisma.MouvementStockWhereInput }>;
export type CleMotif = keyof typeof FILTRES_MOTIF;

/** Filtre NORMALISÉ : `mois` vaut « AAAA-M » ou « tous » (jamais implicite, pour qu'un changement
 *  de mois entre l'affichage et l'action ne déplace pas l'ensemble visé). */
export type FiltreMouvements = { mois: string; articleId: string | null; motif: CleMotif | null };

/** Colonne de l'écran : les sorties d'un côté, les entrées (et ajustements) de l'autre. */
export type ColonneMouvements = "ENTREES" | "SORTIES";

const RE_MOIS = /^(\d{4})-(\d{1,2})$/;
const moisDe = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;

/**
 * Lit un filtre brut (paramètres d'URL, ou argument reçu par une action serveur — donc non fiable)
 * et le normalise : mois absent ou invalide → mois courant ; motif inconnu → aucun.
 */
export function lireFiltreMouvements(brut: { mois?: unknown; articleId?: unknown; motif?: unknown } | null | undefined, maintenant: Date): FiltreMouvements {
  const b = brut ?? {};
  const m = typeof b.mois === "string" ? RE_MOIS.exec(b.mois) : null;
  const mois = b.mois === "tous" ? "tous"
    : m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${Number(m[1])}-${Number(m[2])}`
    : moisDe(maintenant);
  const articleId = typeof b.articleId === "string" && b.articleId.trim() ? b.articleId.trim() : null;
  const motif = typeof b.motif === "string" && Object.prototype.hasOwnProperty.call(FILTRES_MOTIF, b.motif) ? (b.motif as CleMotif) : null;
  return { mois, articleId, motif };
}

/** Le `where` Prisma du filtre — celui de la page ET celui des actions « tout le filtre ». */
export function whereMouvements(f: FiltreMouvements): Prisma.MouvementStockWhereInput {
  const where: Prisma.MouvementStockWhereInput = {
    ...(f.articleId ? { articleId: f.articleId } : {}),
    ...(f.motif ? FILTRES_MOTIF[f.motif].where : {}),
  };
  const m = RE_MOIS.exec(f.mois);
  if (f.mois !== "tous" && m) {
    const y = Number(m[1]), mo = Number(m[2]);
    where.date = { gte: new Date(Date.UTC(y, mo - 1, 1)), lt: new Date(Date.UTC(y, mo, 1)) };
  }
  return where;
}

/** Le filtre restreint à une colonne de l'écran (un `AND` : le type du motif n'est jamais écrasé). */
export function whereColonne(f: FiltreMouvements, colonne: ColonneMouvements): Prisma.MouvementStockWhereInput {
  return { AND: [whereMouvements(f), colonne === "SORTIES" ? { type: "SORTIE" } : { type: { not: "SORTIE" } }] };
}

/** « septembre 2026, produit « Farine », sans motif » — nomme le filtre dans les confirmations. */
export function libelleFiltre(f: FiltreMouvements, designation?: string | null): string {
  const m = RE_MOIS.exec(f.mois);
  const parts = [
    f.mois === "tous" || !m ? "tous les mois" : `${MOIS_FR[Number(m[2]) - 1]} ${m[1]}`,
    f.articleId ? `produit « ${designation ?? "?"} »` : null,
    f.motif ? FILTRES_MOTIF[f.motif].libelle : null,
  ];
  return parts.filter(Boolean).join(", ");
}

/** Ce que reçoit une action groupée : les id cochés, OU tout le filtre d'une colonne avec le
 *  nombre que la Direction a vu et confirmé (le serveur recompte avant d'écrire). */
export type SelectionMouvements = string[] | { filtre: FiltreMouvements; colonne: ColonneMouvements; attendu: number };
