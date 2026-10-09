// Recherche dans une liste d'options (articles, fournisseurs, fiches…) — logique PURE, sans DOM ni
// React : le filtre du champ de choix `ChoixRecherche` (components/choix-recherche.tsx).
//
//  - insensible aux accents et à la casse (« epices » trouve « Épices ») ;
//  - les mots peuvent être dans le désordre : « bacardi 1l » trouve « Bacardi blanc-1l » — chaque
//    mot tapé doit se retrouver quelque part dans le libellé OU dans les textes annexes de l'option
//    (nom court, code…) ;
//  - classement : le libellé qui COMMENCE par la saisie d'abord, puis les mots en début de mot,
//    puis le reste — à égalité, l'ordre d'origine de la liste est conservé (elle est déjà triée) ;
//  - l'index normalisé d'une liste est calculé UNE fois (clé : l'identité du tableau) : vingt lignes
//    d'un tableur qui partagent la même liste ne la normalisent pas vingt fois.

import { normTexte } from "@/lib/texte";
import { libelleArticle, rechercheContenance } from "@/lib/libelle-article";

export type OptionChoix = {
  /** Valeur soumise / renvoyée (id de l'article, du fournisseur…). */
  id: string;
  /** Texte affiché dans le champ une fois choisie, et dans la liste. */
  libelle: string;
  /** Autres textes où chercher, sans les afficher : nom court, code article… */
  recherche?: readonly (string | null | undefined)[];
  /** Précision affichée à droite dans la liste (unité, catégorie…) ; jamais cherchée. */
  detail?: string;
  /** Intitulé de groupe : les options consécutives qui le partagent s'affichent sous ce titre. */
  groupe?: string;
  /** Option à signaler comme mise de côté (article inactif…) : affichée atténuée. */
  attenue?: boolean;
};

type Indexee = { option: OptionChoix; foin: string; debut: string; rangGroupe: number; ordre: number };
export type IndexOptions = { lignes: Indexee[]; parId: Map<string, OptionChoix> };

const INDEX = new WeakMap<readonly OptionChoix[], IndexOptions>();

/** Index normalisé d'une liste d'options (mémorisé par identité du tableau). */
export function indexerOptions(options: readonly OptionChoix[]): IndexOptions {
  let index = INDEX.get(options);
  if (index) return index;
  const rangs = new Map<string, number>();
  const parId = new Map<string, OptionChoix>();
  const lignes = options.map((option, ordre): Indexee => {
    const g = option.groupe ?? "";
    if (!rangs.has(g)) rangs.set(g, rangs.size);
    if (!parId.has(option.id)) parId.set(option.id, option);
    const debut = normTexte(option.libelle).replace(/\s+/g, " ").trim();
    const foin = [debut, ...(option.recherche ?? []).map((t) => normTexte(t ?? "").replace(/\s+/g, " ").trim())].filter(Boolean).join(" | ");
    return { option, foin, debut, rangGroupe: rangs.get(g)!, ordre };
  });
  index = { lignes, parId };
  INDEX.set(options, index);
  return index;
}

/** Mots d'une saisie : minuscules, sans accents, séparés par tout ce qui n'est pas lettre ou chiffre. */
export function motsDe(saisie: string): string[] {
  return normTexte(saisie).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const debutDeMot = (foin: string, mot: string) => {
  for (let i = foin.indexOf(mot); i >= 0; i = foin.indexOf(mot, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(foin[i - 1])) return true;
  }
  return false;
};

/** Options qui répondent à la saisie, classées ; saisie vide (ou sans mot) = toute la liste, dans l'ordre. */
export function filtrerOptions(options: readonly OptionChoix[], saisie: string): OptionChoix[] {
  const { lignes } = indexerOptions(options);
  const mots = motsDe(saisie);
  if (mots.length === 0) return lignes.map((l) => l.option);
  const phrase = normTexte(saisie).replace(/\s+/g, " ").trim();
  const trouvees: { l: Indexee; score: number }[] = [];
  for (const l of lignes) {
    if (!mots.every((m) => l.foin.includes(m))) continue;
    const score = l.debut.startsWith(phrase) ? 0 : mots.every((m) => debutDeMot(l.foin, m)) ? 1 : 2;
    trouvees.push({ l, score });
  }
  // Groupes dans leur ordre d'origine ; dans un groupe : score, puis ordre d'origine.
  trouvees.sort((a, b) => a.l.rangGroupe - b.l.rangGroupe || a.score - b.score || a.l.ordre - b.l.ordre);
  return trouvees.map((t) => t.l.option);
}

/** Libellé d'une option par son id (dans l'index mémorisé), undefined si inconnue. */
export function optionParId(options: readonly OptionChoix[], id: string): OptionChoix | undefined {
  return indexerOptions(options).parId.get(id);
}

/** Article du catalogue, tel que les écrans du stock le reçoivent (seuls l'id et la désignation sont obligatoires). */
export type ArticleRecherchable = {
  id: string;
  designation: string;
  nomCourt?: string | null;
  code?: string | null;
  actif?: boolean;
  /** Contenance enregistrée (texte canonique « 0.75 », nombre ou Decimal) : s'ajoute au libellé (`libelleArticle`). */
  contenance?: string | number | { toString(): string } | null;
  contenanceUnite?: string | null;
};

/**
 * Options d'un choix d'article : le LIBELLÉ affiché (`libelleArticle` : désignation + contenance si le
 * nom ne la porte pas), et l'on cherche dans ce libellé, la désignation, le nom court, le code et les
 * écritures compactes de la contenance (« bacardi 1l » trouve « Bacardi » enregistré 1 l). À
 * calculer UNE fois par écran (`useMemo`) et à partager entre toutes les lignes : la liste n'est
 * jamais recopiée par ligne. Un article inactif garde la règle de l'écran (c'est lui qui décide de
 * le proposer) ; s'il l'est, il s'affiche « (inactif) ».
 */
export function optionsArticles(articles: readonly ArticleRecherchable[], opts: { marquerInactifs?: boolean; prefixe?: string; groupe?: string } = {}): OptionChoix[] {
  const p = opts.prefixe ?? "";
  return articles.map((a) => ({
    id: `${p}${a.id}`,
    libelle: `${libelleArticle(a)}${opts.marquerInactifs && a.actif === false ? " (inactif)" : ""}`,
    recherche: [a.nomCourt, a.code, ...rechercheContenance(a)],
    ...(opts.groupe ? { groupe: opts.groupe } : {}),
    ...(opts.marquerInactifs && a.actif === false ? { attenue: true } : {}),
  }));
}

/**
 * Options d'un choix de fournisseur (ou de toute liste « id + nom »). Même règle : à calculer une fois
 * par écran. `detail` (ville, téléphone, nombre d'articles…) distingue deux fournisseurs aux noms proches.
 */
export function optionsFournisseurs(fournisseurs: readonly { id: string; nom: string; detail?: string }[]): OptionChoix[] {
  return fournisseurs.map((f) => ({ id: f.id, libelle: f.nom, ...(f.detail ? { detail: f.detail } : {}) }));
}
