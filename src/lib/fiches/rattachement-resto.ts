// Propositions de rattachement « article du restaurant → article du catalogue » : fonction PURE.
//
// Une proposition n'est qu'une SUGGESTION affichée : rien n'est rattaché sans que la Direction
// coche la ligne et valide (page Stock → Restaurant). Règle volontairement étroite, pour ne jamais
// deviner : désignations IDENTIQUES sans tenir compte de la casse ni des espaces (les accents
// comptent), article du restaurant encore libre, article du catalogue actif et UNIQUE à porter ce
// nom (deux candidats = aucune proposition).

import { convertirVersUniteArticle } from "./disponibilite";
import { uniteManquante } from "./conversion";

export type RestoPourProposition = { id: string; designation: string; articleStockId: string | null; unite: string | null };
export type CataloguePourProposition = { id: string; designation: string; actif: boolean; unite: string | null };

/**
 * Unités d'une proposition : le comptage du restaurant se convertit vers l'unité du catalogue
 * (`facteur()`, puis poids d'une unité-emballage — la conversion même du calcul de disponibilité).
 * Une proposition signalée reste PROPOSABLE, mais n'est jamais cochée d'office : son stock
 * restaurant serait « unité non convertible » dans la disponibilité des plats.
 */
export type AlerteUnite = "UNITE_MANQUANTE" | "UNITES_INCOMPATIBLES";
export const ALERTE_UNITE_LABEL: Record<AlerteUnite, string> = {
  UNITE_MANQUANTE: "unité manquante",
  UNITES_INCOMPATIBLES: "unités incompatibles",
};

export type Proposition = {
  articleRestoId: string;
  designationResto: string;
  articleStockId: string;
  designationCatalogue: string;
  uniteResto: string | null;
  uniteCatalogue: string | null;
  alerteUnite: AlerteUnite | null;
};

/** « unité manquante » si l'une des deux est vide ; « unités incompatibles » si la conversion est impossible. */
export function alerteUnite(uniteResto: string | null, uniteCatalogue: string | null): AlerteUnite | null {
  if (uniteManquante(uniteResto) || uniteManquante(uniteCatalogue)) return "UNITE_MANQUANTE";
  return convertirVersUniteArticle(1, uniteResto!, uniteCatalogue!) === null ? "UNITES_INCOMPATIBLES" : null;
}

/** Clé de comparaison : minuscules, sans aucun espace (NFC pour qu'un « é » composé égale un « é » précomposé). */
export function cleDesignation(designation: string): string {
  return designation.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

export function proposerRattachements(restos: RestoPourProposition[], catalogue: CataloguePourProposition[]): Proposition[] {
  const parCle = new Map<string, CataloguePourProposition[]>();
  for (const a of catalogue) {
    if (!a.actif) continue;
    const cle = cleDesignation(a.designation);
    parCle.set(cle, [...(parCle.get(cle) ?? []), a]);
  }
  const propositions: Proposition[] = [];
  for (const r of restos) {
    if (r.articleStockId !== null) continue;
    const candidats = parCle.get(cleDesignation(r.designation)) ?? [];
    if (candidats.length !== 1) continue;
    const a = candidats[0]!;
    propositions.push({
      articleRestoId: r.id, designationResto: r.designation, articleStockId: a.id, designationCatalogue: a.designation,
      uniteResto: r.unite, uniteCatalogue: a.unite, alerteUnite: alerteUnite(r.unite, a.unite),
    });
  }
  return propositions;
}
