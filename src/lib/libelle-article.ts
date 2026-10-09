// Libellé AFFICHÉ d'un article du catalogue : sa désignation, complétée de sa contenance quand le nom
// ne la porte pas déjà (demande de la Direction, 2026-10-09 : « la contenance des articles s'insère
// dans leur nom, si ce n'est pas déjà le cas »).
//
// À L'AFFICHAGE SEULEMENT : `ArticleStock.designation` n'est jamais réécrite. Les désignations sont
// des CLÉS — classeurs de la Direction (commande journalière, rapport journalier, fiches du bar),
// anti-doublon du catalogue (`article-proche.ts`, `achats-doublons.ts`), imports, journal d'audit
// « avant → après » — et ces usages-là continuent de lire la désignation brute.
//
// Règles :
//  - contenance enregistrée (`contenance` + `contenanceUnite`) absente ou illisible → la désignation
//    telle quelle ;
//  - le nom porte DÉJÀ cette contenance, sous n'importe quelle écriture (« 70cl » = « 70 cl » =
//    « 700ml » ; « 1L » = « 1 l » = « 100cl » = « 1000ml » = « 1LTR ») → la désignation telle quelle ;
//  - le nom porte une AUTRE contenance (« Cointreau-70cl » enregistré 1 l) → rien n'est ajouté
//    (« Cointreau-70cl 1 l » serait pire) : c'est une INCOHÉRENCE, signalée sur la fiche article
//    (`incoherenceContenance`) — la Direction tranche, le logiciel ne corrige pas ;
//  - sinon → « Désignation 70 cl » : nombre à la française, unité en minuscules (« 75 cl », « 1 l »,
//    « 0,75 l », « 2 kg », « 700 ml »).
//
// Pur, sans Prisma ni React : utilisable côté serveur (pages, PDF, exports) comme côté client.
// Garde-fou de source : `libelle-article.garde-fou.test.ts`.

import Decimal from "decimal.js";
import { contenanceCanonique, contenanceDansNom, contenancesDansNom, normaliserUnite, UNITES_CONTENANCE, type UniteContenance } from "@/lib/fiches/conversion";
import { formaterNombre } from "@/lib/montant";

/** Ce dont le libellé a besoin : la désignation et la contenance enregistrée (Decimal Prisma, texte ou nombre). */
export type ArticleLibelle = {
  designation: string;
  contenance?: Decimal.Value | { toString(): string } | null;
  contenanceUnite?: string | null;
};

type Contenance = { quantite: Decimal; unite: UniteContenance };

/** Contenance ENREGISTRÉE de l'article, lisible et > 0 ; null sinon (jamais une valeur supposée). */
export function contenanceEnregistree(a: Pick<ArticleLibelle, "contenance" | "contenanceUnite">): Contenance | null {
  if (a.contenance === null || a.contenance === undefined || !a.contenanceUnite) return null;
  const unite = UNITES_CONTENANCE.find((u) => u === normaliserUnite(a.contenanceUnite!));
  if (!unite) return null;
  try {
    const quantite = new Decimal(String(a.contenance).trim());
    return quantite.isFinite() && quantite.greaterThan(0) ? { quantite, unite } : null;
  } catch {
    return null;
  }
}

/** « 70 cl », « 0,75 l », « 1 000 ml » : nombre à la française (3 décimales au plus), unité en minuscules. */
export function formaterContenance(c: { quantite: Decimal.Value; unite: string }): string {
  return `${formaterNombre(new Decimal(c.quantite).toNumber(), { maximumFractionDigits: 3 })} ${c.unite.toLowerCase()}`;
}

type Analyse = {
  /** Libellé affiché. */
  libelle: string;
  /** Ce qui a été ajouté à la désignation (« 70 cl »), null si rien. */
  ajout: string | null;
  /** Le nom dit une contenance, la fiche en enregistre une autre. */
  incoherence: { dansNom: string; enregistree: string } | null;
};

function analyser(a: ArticleLibelle): Analyse {
  const designation = a.designation ?? "";
  const enregistree = contenanceEnregistree(a);
  if (!enregistree) return { libelle: designation, ajout: null, incoherence: null };
  const mentions = contenancesDansNom(designation);
  const cle = contenanceCanonique(enregistree);
  if (mentions.some((m) => contenanceCanonique(m) === cle)) return { libelle: designation, ajout: null, incoherence: null };
  if (mentions.length > 0) {
    // La DERNIÈRE mention est celle que le reste du logiciel lit (`contenanceDansNom` : « 12 X 1KG » = 1 kg).
    const dit = contenanceDansNom(designation) ?? mentions[mentions.length - 1]!;
    return { libelle: designation, ajout: null, incoherence: { dansNom: formaterContenance(dit), enregistree: formaterContenance(enregistree) } };
  }
  const ajout = formaterContenance(enregistree);
  const base = designation.trimEnd();
  return { libelle: base ? `${base} ${ajout}` : ajout, ajout, incoherence: null };
}

/**
 * LE libellé affiché d'un article : « Absolut Vodka 75 cl » pour la désignation « Absolut Vodka » et
 * une contenance de 75 cl ; « Absolut Vodka-75cl » inchangé (le nom la porte déjà).
 */
export function libelleArticle(a: ArticleLibelle): string {
  return analyser(a).libelle;
}

/** Le complément que le libellé ajoute à la désignation (« 75 cl »), null s'il n'ajoute rien. */
export function complementLibelle(a: ArticleLibelle): string | null {
  return analyser(a).ajout;
}

/**
 * Incohérence entre le nom et la contenance enregistrée, avec la phrase à afficher sur la fiche
 * article : « le nom dit 70 cl, la contenance enregistrée est 1 l ». null si cohérent ou si l'un des
 * deux manque.
 */
export function incoherenceContenance(a: ArticleLibelle): { dansNom: string; enregistree: string; message: string } | null {
  const i = analyser(a).incoherence;
  return i ? { ...i, message: `le nom dit ${i.dansNom}, la contenance enregistrée est ${i.enregistree}` } : null;
}

const enCompact = (d: Decimal) => d.toString().replace(".", ",");

/**
 * Écritures COMPACTES de la contenance enregistrée, pour la recherche (jamais affichées) : « 75cl »,
 * « 750ml », « 0,75l » pour 75 cl ; « 2kg », « 2000g » pour 2 kg. Ainsi « bacardi 1l » trouve
 * « Bacardi » enregistré 1 l, quelle que soit l'écriture tapée (1l, 100cl, 1000ml).
 */
export function rechercheContenance(a: Pick<ArticleLibelle, "contenance" | "contenanceUnite">): string[] {
  const c = contenanceEnregistree(a);
  if (!c) return [];
  const cle = contenanceCanonique(c);
  if (!cle) return [];
  const base = new Decimal(cle.slice(2));
  const formes = cle.startsWith("v:")
    ? [`${enCompact(base)}ml`, `${enCompact(base.div(10))}cl`, `${enCompact(base.div(1000))}l`]
    : [`${enCompact(base)}g`, `${enCompact(base.div(1000))}kg`];
  return [...new Set(formes)];
}
