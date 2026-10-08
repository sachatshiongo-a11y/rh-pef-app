// ─────────────────────────────────────────────────────────────────────────────
// DOUBLON D'ARTICLE AU CATALOGUE — la règle de l'application Atelier, portée dans PEF (2026-10-08).
//
// Précision de Sacha : chez PEF, taper « Tomate » quand « Tomates » existe créait un second article
// EN SILENCE (le seul filet était l'égalité exacte). L'Atelier montre les noms proches et demande
// de choisir ; PEF fait désormais de même, dans les deux vues de la Liste d'achat.
//
// Porté depuis atelier-dominique-app/src/lib/article-saisie.ts (`articlesProches`,
// `SEUIL_ARTICLE_PROCHE`), sans import croisé : même calcul de ressemblance (`similariteNom`, qui
// existe à l'identique dans ce dépôt — l'Atelier l'a dérivé d'ici), même seuil (0,65), même
// exclusion de l'article de même nom, même ordre (meilleur score, puis ordre du catalogue), même
// plafond (5). Ce que ce calcul rapproche : pluriel simple et lettre d'écart (« Tomate »/« Tomates »,
// « Chou »/« Choux », « Huile de palm »), accents, casse, espaces et ponctuation, ORDRE des mots
// (« Huile palme »/« Huile de palme »). Ajout PEF : la CONTENANCE n'entre PAS dans la ressemblance —
// on compare les noms sans elle. Sinon « Fanta 50cl » ressemblait à « Coca-Cola 50cl » (le « 50cl »
// commun suffisait), et presque toute boisson nouvelle déclenchait un choix absurde. Même nom, autre
// contenance (« Coca 33cl » / « Coca 50cl ») reste PROCHE : un nouveau format se confirme d'un geste
// (« Créer quand même »), une faute de frappe ne passe pas. L'égalité de contenance écrite autrement
// (33cl = 330 ml) relève de l'EXACT (`memeDesignation`), pas d'ici.
//
// Module PUR : le serveur l'applique au catalogue lu en base, à la saisie comme à l'enregistrement.
// ─────────────────────────────────────────────────────────────────────────────

import { similariteNom } from "@/lib/fournisseur-match";
import { sansContenance } from "@/lib/fiches/conversion";
import { memeDesignation, sansLigatures, type ArticleCandidat, type DecisionArticle } from "@/lib/achats-doublons";

/**
 * Seuil de ressemblance au-delà duquel on MONTRE un article existant avant de créer — celui de
 * l'Atelier. Plus bas que celui des fournisseurs (0,7) : une désignation est courte (« Riz »,
 * « Sel »), et se tromper vers le haut ne coûte qu'une suggestion, vers le bas un doublon en base.
 */
export const SEUIL_ARTICLE_PROCHE = 0.65;
/** Au plus autant d'articles proposés (du plus ressemblant au moins) : une liste qui reste lisible. */
export const MAX_PROCHES = 5;

/** Le nom à comparer : sans sa contenance, ligatures dépliées (« Œufs 30 pièces » → « Oeufs 30 pièces »). */
const nomComparable = (nom: string): string => sansContenance(sansLigatures(nom));

/** Un candidat au doublon : l'article existant et le score qui l'a fait remonter. */
export type ArticleProche<T> = { article: T; score: number };

/**
 * Les articles du catalogue qui RESSEMBLENT au nom tapé — ce qu'on montre avant de créer. Les
 * articles EXACTEMENT du même nom (`memeDesignation`) en sont exclus : ce ne sont pas des proches,
 * c'est le même article.
 */
export function articlesProches<T extends { designation: string }>(
  nom: string,
  articles: readonly T[],
  { max = MAX_PROCHES, seuil = SEUIL_ARTICLE_PROCHE }: { max?: number; seuil?: number } = {},
): ArticleProche<T>[] {
  if (!/[\p{L}\p{N}]/u.test(nom ?? "")) return [];
  const tape = nomComparable(nom);
  const candidats: { article: T; score: number; ordre: number }[] = [];
  articles.forEach((article, ordre) => {
    if (memeDesignation(nom, article.designation)) return; // le même article, pas un proche
    const score = similariteNom(tape, nomComparable(article.designation));
    if (score >= seuil) candidats.push({ article, score, ordre });
  });
  candidats.sort((a, b) => b.score - a.score || a.ordre - b.ordre);
  return candidats.slice(0, max).map(({ article, score }) => ({ article, score }));
}

/**
 * Sort au catalogue d'une ligne LIBRE (désignation tapée). `articles` : TOUT le catalogue.
 *  - UN article du même nom exact (accents, casse, espaces, séparateurs, écriture de la contenance
 *    près — `memeDesignation`), même inactif : rattachement automatique (on ne recrée pas un article
 *    mis de côté) ;
 *  - PLUSIEURS : choix entre eux, sans « Créer quand même » (un de plus serait un doublon certain) ;
 *  - des articles ACTIFS proches : choix, avec « Créer quand même » (« Tomate cerise » à côté de
 *    « Tomate » est légitime) ;
 *  - rien : nouvel article.
 */
export function decisionArticle(designation: string, articles: readonly ArticleCandidat[]): DecisionArticle {
  const nom = (designation ?? "").trim();
  if (!nom) return { type: "nouveau" };
  const exacts = articles.filter((a) => memeDesignation(nom, a.designation));
  if (exacts.length === 1) return { type: "auto", article: exacts[0] };
  if (exacts.length > 1) return { type: "choix", candidats: exacts.slice(0, MAX_PROCHES), creationPossible: false };
  const proches = articlesProches(nom, articles.filter((a) => a.actif)).map((p) => p.article);
  return proches.length > 0 ? { type: "choix", candidats: proches, creationPossible: true } : { type: "nouveau" };
}

/**
 * Noms PROCHES entre deux lignes NOUVELLES d'une même liste (relecture du 2026-10-08) : « Poivrons »
 * puis « Poivron », aucun des deux au catalogue, créaient deux articles sans rien demander. Pour
 * chaque ligne qui créera un article (`creera(i)`), les lignes PRÉCÉDENTES qui créeront aussi un
 * article sous un nom proche (même règle que le catalogue) mais pas exactement le même (le même nom
 * exact ne crée qu'un article). La seconde ligne demande alors « Utiliser la ligne n » ou « Créer
 * quand même ». Rend, par indice de ligne, les indices des lignes proches qui la précèdent.
 */
export function prochesDansListe(designations: readonly string[], creera: (i: number) => boolean): Map<number, number[]> {
  const res = new Map<number, number[]>();
  designations.forEach((nom, i) => {
    if (!creera(i) || !nom.trim()) return;
    const avant = designations.slice(0, i).map((d, j) => ({ designation: d, j })).filter(({ designation, j }) => creera(j) && designation.trim() && !memeDesignation(nom, designation));
    const proches = articlesProches(nom, avant, { max: MAX_PROCHES }).map((p) => p.article.j);
    if (proches.length > 0) res.set(i, proches);
  });
  return res;
}
