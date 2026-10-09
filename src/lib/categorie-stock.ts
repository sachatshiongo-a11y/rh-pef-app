// ─────────────────────────────────────────────────────────────────────────────
// CATÉGORIES DU STOCK — anti-doublon de nom (Direction, 2026-10-09 : « dans l'inventaire on doit
// pouvoir créer ou modifier des catégories »).
//
// Une catégorie vit dans UN domaine (Nourriture, Boissons, Autre) et `@@unique([domaine, nom])` ne
// voit que l'égalité exacte à la lettre près. Ce module PUR rapproche donc aussi la casse, les accents,
// les espaces, le pluriel (« Tomate »/« Tomates ») et l'ordre des mots, avec EXACTEMENT la règle de
// l'anti-doublon d'article (`memeDesignation` pour le même nom, `articlesProches` pour le proche).
// Différence assumée avec l'article : ici le proche est REFUSÉ (pas de « Créer quand même ») — une
// catégorie est un mot de classement, deux mots presque identiques ne servent qu'à éparpiller les
// articles. Les catégories ARCHIVÉES comptent : on réactive, on ne recrée pas.
// ─────────────────────────────────────────────────────────────────────────────

import { articlesProches } from "@/lib/article-proche";
import { memeDesignation } from "@/lib/achats-doublons";
import { DOMAINE_LABEL } from "@/lib/stock";

/**
 * Seuil de ressemblance d'une CATÉGORIE : plus haut que celui des articles (0,65). Le calcul d'article
 * rend des scores par paliers : 0,9 pour un pluriel, une lettre d'écart, un mot ajouté ou l'ordre des mots
 * (« Tomate »/« Tomates », « Huile palme »/« Huile de palme ») et 0,8 dès que DEUX noms partagent un mot et
 * en changent un autre (« Boissons chaudes »/« Boissons froides », « Viande rouge »/« Viande blanche »).
 * Ces dernières sont des catégories sœurs légitimes, et un refus sans « Créer quand même » ne doit pas les
 * bloquer : 0,85 garde le premier palier (refusé) et laisse passer le second.
 */
export const SEUIL_CATEGORIE_PROCHE = 0.85;

export type CategorieNommee = { id: string; nom: string; domaine: string; actif: boolean };

/** Longueur maximale d'un nom de catégorie (une pastille, un titre de groupe : court). */
export const NOM_CATEGORIE_MAX = 60;

/** Nom saisi nettoyé : espaces de bord retirés, espaces internes réduits à un seul. */
export const nomCategorieNet = (nom: string): string => String(nom ?? "").replace(/\s+/g, " ").trim();

/**
 * La catégorie du MÊME domaine qui porte déjà ce nom (`exact`) ou un nom très proche (`proche`),
 * hors `exclureId` (la catégorie qu'on renomme). Null = nom libre. L'exact l'emporte sur le proche.
 */
export function doublonDeCategorie<T extends CategorieNommee>(
  nom: string,
  domaine: string,
  categories: readonly T[],
  exclureId?: string,
): { categorie: T; exact: boolean } | null {
  const memeDomaine = categories.filter((c) => c.domaine === domaine && c.id !== exclureId);
  const exact = memeDomaine.find((c) => memeDesignation(nom, c.nom));
  if (exact) return { categorie: exact, exact: true };
  // `articlesProches` compare des « désignations » : on lui présente les noms de catégorie sous ce champ.
  const proche = articlesProches(nom, memeDomaine.map((c) => ({ designation: c.nom, c })), { max: 1, seuil: SEUIL_CATEGORIE_PROCHE })[0];
  return proche ? { categorie: proche.article.c, exact: false } : null;
}

/** Le refus affiché : nomme la catégorie existante, son domaine, et dit quoi faire si elle est archivée. */
export function messageDoublonCategorie(nom: string, d: { categorie: CategorieNommee; exact: boolean }): string {
  const domaine = DOMAINE_LABEL[d.categorie.domaine] ?? d.categorie.domaine;
  const exist = `« ${d.categorie.nom} » (${domaine})`;
  const sortie = d.categorie.actif ? "Utilisez-la plutôt." : "Elle est archivée : réactivez-la plutôt.";
  return d.exact
    ? `La catégorie ${exist} existe déjà. ${sortie} Rien n'a été enregistré.`
    : `« ${nom} » ressemble trop à la catégorie ${exist}. ${sortie} Rien n'a été enregistré.`;
}
