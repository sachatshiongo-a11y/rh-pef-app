// FOURNISSEURS PROPOSÉS À UN ACHAT (2026-10-16) — module PUR (ni base, ni React).
//
// Les achats (Liste d'achat, bons de commande, factures) proposent D'ABORD les fournisseurs connus de l'article
// choisi — l'habituel en tête, puis les autres fournisseurs de l'article —, SANS EMPÊCHER d'en choisir un autre :
// tous les fournisseurs restent dans la liste, sous les connus. Rien n'est jamais présélectionné à la place de
// la personne (un fournisseur présélectionné par erreur serait ensuite ajouté à l'article par l'achat).

import type { OptionChoix } from "@/lib/recherche-options";

/** Un lien article ↔ fournisseur, tel que les écrans le reçoivent. */
export type LienFournisseur = { fournisseurId: string; habituel: boolean };
export type FournisseurSimple = { id: string; nom: string };

export const GROUPE_CONNUS = "Fournisseurs de cet article";
export const GROUPE_AUTRES = "Autres fournisseurs";
export const GROUPE_DES_ARTICLES = "Fournisseurs des articles de ce bon";

const parNom = (a: FournisseurSimple, b: FournisseurSimple) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" });

/**
 * Les fournisseurs connus d'UN article, dans l'ordre : l'habituel d'abord, puis les autres par nom. Un lien vers
 * un fournisseur que la liste ne contient plus (désactivé, supprimé) est ignoré.
 */
export function fournisseursConnus(tous: readonly FournisseurSimple[], liens: readonly LienFournisseur[]): { id: string; nom: string; habituel: boolean }[] {
  const parId = new Map(tous.map((f) => [f.id, f]));
  const vus = new Set<string>();
  const connus: { id: string; nom: string; habituel: boolean }[] = [];
  for (const l of liens) {
    const f = parId.get(l.fournisseurId);
    if (!f || vus.has(f.id)) continue;
    vus.add(f.id);
    connus.push({ id: f.id, nom: f.nom, habituel: l.habituel });
  }
  return connus.sort((a, b) => Number(b.habituel) - Number(a.habituel) || parNom(a, b));
}

/**
 * Options d'un choix de fournisseur pour UN article : ses fournisseurs connus en tête (groupe « Fournisseurs de cet
 * article », « habituel » en détail), puis TOUS les autres (groupe « Autres fournisseurs »). Article sans
 * fournisseur connu : la liste complète, sans groupe — comme avant.
 */
export function optionsFournisseursPourArticle(tous: readonly FournisseurSimple[], liens: readonly LienFournisseur[]): OptionChoix[] {
  const connus = fournisseursConnus(tous, liens);
  if (connus.length === 0) return [...tous].sort(parNom).map((f) => ({ id: f.id, libelle: f.nom }));
  const ids = new Set(connus.map((c) => c.id));
  return [
    ...connus.map((c): OptionChoix => ({ id: c.id, libelle: c.nom, groupe: GROUPE_CONNUS, ...(c.habituel ? { detail: "habituel" } : {}) })),
    ...[...tous].filter((f) => !ids.has(f.id)).sort(parNom).map((f): OptionChoix => ({ id: f.id, libelle: f.nom, groupe: GROUPE_AUTRES })),
  ];
}

/**
 * Options d'un choix de fournisseur d'un DOCUMENT (bon, facture) dont les lignes visent plusieurs articles : les
 * fournisseurs qui fournissent le plus d'articles du document en tête (« 3 sur 4 articles »), à égalité l'habituel
 * d'un plus grand nombre d'entre eux, puis par nom ; tous les autres ensuite. Aucun article choisi : liste simple.
 */
export function optionsFournisseursPourArticles(tous: readonly FournisseurSimple[], liensParArticle: ReadonlyMap<string, readonly LienFournisseur[]>, articleIds: readonly string[]): OptionChoix[] {
  const choisis = [...new Set(articleIds.filter(Boolean))];
  const score = new Map<string, { n: number; habituel: number }>();
  for (const a of choisis) {
    for (const l of liensParArticle.get(a) ?? []) {
      const s = score.get(l.fournisseurId) ?? { n: 0, habituel: 0 };
      s.n += 1;
      if (l.habituel) s.habituel += 1;
      score.set(l.fournisseurId, s);
    }
  }
  const connus = tous.filter((f) => score.has(f.id)).sort((a, b) => score.get(b.id)!.n - score.get(a.id)!.n || score.get(b.id)!.habituel - score.get(a.id)!.habituel || parNom(a, b));
  if (connus.length === 0) return [...tous].sort(parNom).map((f) => ({ id: f.id, libelle: f.nom }));
  const ids = new Set(connus.map((c) => c.id));
  return [
    ...connus.map((f): OptionChoix => ({ id: f.id, libelle: f.nom, groupe: GROUPE_DES_ARTICLES, detail: `${score.get(f.id)!.n} sur ${choisis.length} article${choisis.length > 1 ? "s" : ""}` })),
    ...[...tous].filter((f) => !ids.has(f.id)).sort(parNom).map((f): OptionChoix => ({ id: f.id, libelle: f.nom, groupe: GROUPE_AUTRES })),
  ];
}

/** Regroupe des liens à plat (une ligne par couple) par article — la forme qu'attendent les écrans. */
export function liensParArticle(liens: readonly { articleId: string; fournisseurId: string; habituel: boolean }[]): Map<string, LienFournisseur[]> {
  const m = new Map<string, LienFournisseur[]>();
  for (const l of liens) {
    const arr = m.get(l.articleId) ?? [];
    arr.push({ fournisseurId: l.fournisseurId, habituel: l.habituel });
    m.set(l.articleId, arr);
  }
  return m;
}
