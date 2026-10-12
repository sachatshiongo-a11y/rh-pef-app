import { memeDesignation } from "@/lib/achats-doublons";
import { meilleurArticle } from "@/lib/article-match";

// LECTURE D'UN PDF DE FACTURE : rattachement d'une ligne à un article du catalogue (audit du 10/10/2026,
// constat 8). « Lait entier 1L » était rattaché à « Lait de coco » (score 1,0 : un seul mot-clé en
// commun) ET la désignation de la ligne réécrite par celle de l'article. Règle de fond : un appariement
// incertain se SIGNALE, il ne s'applique pas.
//  - `article` : rattaché D'OFFICE seulement sur un nom IDENTIQUE (casse, accents, espaces, écriture de la
//    contenance) et UNIQUE ;
//  - `suggestion` : l'article le plus proche par mots-clés, PROPOSÉ (ligne « à choisir ») — jamais appliqué ;
//  - la désignation lue dans le PDF n'est jamais touchée par ce module.

type Candidat = { id: string; designation: string };

export function rapprocherLignePdf<T extends Candidat>(designation: string, catalogue: readonly T[]): { article: T | null; suggestion: T | null } {
  const identiques = catalogue.filter((a) => memeDesignation(designation, a.designation));
  if (identiques.length === 1) return { article: identiques[0], suggestion: null };
  const m = meilleurArticle(designation, catalogue.map((a) => ({ id: a.id, designation: a.designation })));
  return { article: null, suggestion: m ? catalogue.find((a) => a.id === m.id) ?? null : null };
}
