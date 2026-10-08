// Rattachement « article du restaurant → article du catalogue » : fonctions PURES.
//
// Deux usages d'UNE MÊME clé de désignation (`cleRattachement`) :
//  1. PROPOSITIONS (page Stock → Restaurant) : pour un article du restaurant encore libre, une
//     SUGGESTION que la Direction coche et valide ; rien n'est écrit sans case cochée.
//  2. RATTACHEMENT AUTOMATIQUE (demande de Sacha du 2026-10-08, « je veux un rattachement
//     automatique ») : un article du catalogue LIVRÉ au restaurant sans article du restaurant
//     rattaché est rattaché, ou un article du restaurant est créé pour lui — sans jamais deviner :
//     un seul candidat, sinon la ligne reste à choisir (voir `planifierRattachementsAuto`).
// Règle de la clé : désignations IDENTIQUES aux accents, à la casse, aux espaces et à la ponctuation
// près, contenance ramenée à une écriture unique (« 1L » = « 100cl » = « 1000 ml ») ; le nom court
// du catalogue vaut sa désignation. Un pluriel ou un mot en plus restent DIFFÉRENTS.

import Decimal from "decimal.js";
import { convertirVersUniteArticle } from "./disponibilite";
import { uniteManquante, type UniteArticle } from "./conversion";
import { sansAccents } from "@/lib/texte";

export type RestoPourProposition = { id: string; designation: string; articleStockId: string | null; unite: string | null };
export type CataloguePourProposition = {
  id: string; designation: string; actif: boolean; unite: string | null;
  /** Nom court (fiche « Commande journalière ») : vaut la désignation pour le rapprochement. */
  nomCourt?: string | null;
  /** Contenance (bouteille de 75 cl) : un comptage en cl s'y convertit. */
  contenance?: { toString(): string } | string | null; contenanceUnite?: string | null;
};

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
export function alerteUnite(uniteResto: string | null, catalogue: UniteArticle): AlerteUnite | null {
  if (uniteManquante(uniteResto) || uniteManquante(catalogue.unite)) return "UNITE_MANQUANTE";
  return convertirVersUniteArticle(1, uniteResto!, catalogue) === null ? "UNITES_INCOMPATIBLES" : null;
}

// Contenance écrite dans une désignation : « 33cl », « 0,33 L », « 1 litre », « 500 gr », « 1kg ».
// Ramenée en ml (volumes) ou en g (masses), pleine précision : « 1L » et « 100cl » donnent « 1000ml ».
const CONTENANCE = /(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l|ltr|litres?|g|gr|grammes?|kg|kilos?)(?![a-z])/g;
const FACTEUR_CONTENANCE: Record<string, [number, "ml" | "g"]> = {
  ml: [1, "ml"], cl: [10, "ml"], dl: [100, "ml"], l: [1000, "ml"], ltr: [1000, "ml"], litre: [1000, "ml"], litres: [1000, "ml"],
  g: [1, "g"], gr: [1, "g"], gramme: [1, "g"], grammes: [1, "g"], kg: [1000, "g"], kilo: [1000, "g"], kilos: [1000, "g"],
};

/**
 * Clé de comparaison des désignations : sans accents, minuscules, contenance canonique, puis SANS
 * espaces ni ponctuation (« Coca-Cola 33 cl » = « coca cola 0,33L »). Vide : jamais un candidat.
 */
export function cleRattachement(designation: string | null | undefined): string {
  const t = sansAccents(String(designation ?? "").normalize("NFC")).toLowerCase();
  const canon = t.replace(CONTENANCE, (_m, n: string, u: string) => {
    const [f, unite] = FACTEUR_CONTENANCE[u]!;
    return ` ${new Decimal(n.replace(",", ".")).times(f).toString()}${unite} `;
  });
  return canon.replace(/[^a-z0-9]/g, "");
}

/** Clés d'un article du catalogue : sa désignation et son nom court (s'il en a un). */
export function clesCatalogue(a: { designation: string; nomCourt?: string | null }): string[] {
  return [...new Set([cleRattachement(a.designation), cleRattachement(a.nomCourt)].filter((c) => c !== ""))];
}

export function proposerRattachements(restos: RestoPourProposition[], catalogue: CataloguePourProposition[]): Proposition[] {
  const parCle = new Map<string, CataloguePourProposition[]>();
  for (const a of catalogue) {
    if (!a.actif) continue;
    for (const cle of clesCatalogue(a)) parCle.set(cle, [...(parCle.get(cle) ?? []), a]);
  }
  const propositions: Proposition[] = [];
  for (const r of restos) {
    if (r.articleStockId !== null) continue;
    const candidats = parCle.get(cleRattachement(r.designation)) ?? [];
    if (candidats.length !== 1) continue;
    const a = candidats[0]!;
    propositions.push({
      articleRestoId: r.id, designationResto: r.designation, articleStockId: a.id, designationCatalogue: a.designation,
      uniteResto: r.unite, uniteCatalogue: a.unite, alerteUnite: alerteUnite(r.unite, { unite: a.unite, contenance: a.contenance?.toString() ?? null, contenanceUnite: a.contenanceUnite ?? null }),
    });
  }
  return propositions;
}

// ─── Rattachement AUTOMATIQUE des livraisons (demande de Sacha du 2026-10-08) ───────────────────

/** Article du catalogue LIVRÉ au restaurant (sortie « Livraison restaurant »), tel que la règle le lit. */
export type CibleAuto = {
  id: string; designation: string; nomCourt: string | null; actif: boolean;
  domaine: "NOURRITURE" | "BOISSON" | "AUTRE" | string;
  unite: string | null; contenance: string | null; contenanceUnite: string | null;
  /** Nom de la catégorie du catalogue (null : « À classer »). */
  categorie: string | null;
};
/** Article du restaurant, ACTIF OU NON (un désactivé homonyme bloque la création d'un doublon). */
export type RestoAuto = {
  id: string; designation: string; espace: "CUISINE" | "BAR"; unite: string | null; actif: boolean;
  articleStockId: string | null;
  /** Désignation de l'article du catalogue auquel il est rattaché (pour dire « rattaché à … »). */
  rattacheA: string | null;
};

export type MotifLaisse =
  | "PLUSIEURS_CANDIDATS" | "PLUSIEURS_ARTICLES_CATALOGUE" | "HOMONYME" | "RATTACHE_DESACTIVE" | "UNITES" | "DOMAINE_AUTRE"
  | "UNITE_CATALOGUE" | "CATALOGUE_INACTIF";

export type DecisionAuto =
  | { action: "RATTACHER"; articleStockId: string; articleRestoId: string; designationResto: string; espace: "CUISINE" | "BAR" }
  | { action: "CREER"; articleStockId: string; designation: string; unite: string; categorie: string; espace: "CUISINE" | "BAR" }
  | { action: "LAISSER"; articleStockId: string; motif: MotifLaisse; raison: string };

export const CATEGORIE_A_CLASSER = "À classer";
export const NOM_ESPACE: Record<"CUISINE" | "BAR", string> = { CUISINE: "Cuisine", BAR: "Bar" };

const espaceDeDomaine = (domaine: string): "CUISINE" | "BAR" | null => (domaine === "NOURRITURE" ? "CUISINE" : domaine === "BOISSON" ? "BAR" : null);
const guillemets = (noms: string[]) => noms.map((n) => `« ${n} »`).join(", ");

/**
 * Ce que le rattachement automatique fait pour chaque article du catalogue livré SANS article du
 * restaurant rattaché (un article déjà rattaché, actif, n'apparaît pas dans le résultat). Les cibles
 * sont traitées une à une dans l'ordre reçu, sur une COPIE de l'état : un article du restaurant pris
 * par une cible ne l'est pas par la suivante ; un article créé pour l'une est un homonyme pour
 * l'autre. Jamais deviné :
 *   a) exactement UN article du restaurant libre (actif, non rattaché) porte la même clé (désignation
 *      ou nom court du catalogue) — à défaut, un seul DANS L'ESPACE du domaine (nourriture → Cuisine,
 *      boissons → Bar) — et ses unités se convertissent : RATTACHER ;
 *   b) aucun candidat libre : CRÉER un article du restaurant dans l'espace du domaine (nom court,
 *      sinon désignation ; unité et catégorie du catalogue, « À classer » à défaut ; stock de base
 *      vide) — sauf s'il ferait doublon (même clé déjà présente dans cet espace, active ou non), si le
 *      domaine ne dit pas l'espace (« Autre ») ou si l'unité du catalogue manque ;
 *   c) PLUSIEURS candidats libres : rien n'est écrit, la ligne reste à choisir (créer un troisième
 *      homonyme partagerait le comptage d'un même produit entre plusieurs lignes de la grille).
 * Et avant tout : un nom porté par PLUSIEURS articles actifs du catalogue (`catalogue`, plus les
 * cibles) n'est ni rattaché ni créé — c'est l'ambiguïté que les propositions refusent déjà.
 */
export function planifierRattachementsAuto(
  cibles: CibleAuto[], restos: RestoAuto[],
  /** Articles ACTIFS du catalogue (désignation, nom court) : un nom porté par deux d'entre eux est ambigu. */
  catalogue: { id: string; designation: string; nomCourt?: string | null }[] = [],
): DecisionAuto[] {
  const etat = restos.map((r) => ({ ...r }));
  const decisions: DecisionAuto[] = [];
  const porteurs = new Map<string, { id: string; designation: string }[]>();
  for (const a of [...catalogue, ...cibles.filter((c) => c.actif && !catalogue.some((x) => x.id === c.id))]) {
    for (const cle of clesCatalogue(a)) porteurs.set(cle, [...(porteurs.get(cle) ?? []), a]);
  }
  for (const c of cibles) {
    if (etat.some((r) => r.actif && r.articleStockId === c.id)) continue; // déjà rattaché : rien à faire
    const laisser = (motif: MotifLaisse, raison: string) => decisions.push({ action: "LAISSER", articleStockId: c.id, motif, raison });
    if (!c.actif) { laisser("CATALOGUE_INACTIF", "article du catalogue désactivé : réactivez-le au catalogue avant tout rattachement"); continue; }
    const desactives = etat.filter((r) => !r.actif && r.articleStockId === c.id);
    if (desactives.length > 0) {
      laisser("RATTACHE_DESACTIVE", `${guillemets(desactives.map((r) => r.designation))} lui est rattaché mais désactivé au restaurant : réactivez-le, ou rattachez un autre article`);
      continue;
    }
    const cles = new Set(clesCatalogue(c));
    // Même nom (désignation ou nom court) porté par un AUTRE article du catalogue : lequel des deux
    // est le produit du restaurant ? Jamais tranché ici (même règle que les propositions).
    const autres = [...new Map([...cles].flatMap((k) => porteurs.get(k) ?? []).filter((a) => a.id !== c.id).map((a) => [a.id, a])).values()];
    if (autres.length > 0) {
      laisser("PLUSIEURS_ARTICLES_CATALOGUE", `${guillemets(autres.map((a) => a.designation))} porte${autres.length > 1 ? "nt" : ""} le même nom au catalogue : rattachez à la main (ou fusionnez les doublons du catalogue)`);
      continue;
    }
    const homonymes = etat.filter((r) => cles.has(cleRattachement(r.designation)));
    const espace = espaceDeDomaine(c.domaine);
    let libres = homonymes.filter((r) => r.actif && r.articleStockId === null);
    if (libres.length > 1 && espace) {
      const dansEspace = libres.filter((r) => r.espace === espace);
      if (dansEspace.length === 1) libres = dansEspace;
    }
    if (libres.length > 1) {
      laisser("PLUSIEURS_CANDIDATS", `${libres.length} articles du restaurant portent ce nom (${libres.map((r) => `« ${r.designation} », ${NOM_ESPACE[r.espace]}`).join(" ; ")}) : choisissez`);
      continue;
    }
    if (libres.length === 1) {
      const r = libres[0]!;
      const alerte = alerteUnite(r.unite, { unite: c.unite, contenance: c.contenance, contenanceUnite: c.contenanceUnite });
      if (alerte) {
        laisser("UNITES", `« ${r.designation} » (${NOM_ESPACE[r.espace]}) porte ce nom, mais ${alerte === "UNITE_MANQUANTE" ? "une unité manque" : "les unités ne se convertissent pas"} (restaurant : ${r.unite?.trim() || "—"}, catalogue : ${c.unite?.trim() || "—"}) : vérifiez puis rattachez à la main`);
        continue;
      }
      r.articleStockId = c.id;
      r.rattacheA = c.designation;
      decisions.push({ action: "RATTACHER", articleStockId: c.id, articleRestoId: r.id, designationResto: r.designation, espace: r.espace });
      continue;
    }
    if (!espace) { laisser("DOMAINE_AUTRE", "domaine « Autre » au catalogue : l'espace du restaurant (Cuisine ou Bar) n'est pas connu, rattachez à la main"); continue; }
    const doublons = homonymes.filter((r) => r.espace === espace);
    if (doublons.length > 0) {
      const d = doublons[0]!;
      laisser("HOMONYME", `« ${d.designation} » existe déjà au restaurant (${NOM_ESPACE[espace]}, ${!d.actif ? "désactivé" : `rattaché à « ${d.rattacheA ?? "un autre article"} »`}) : choisissez, pour ne pas créer de doublon`);
      continue;
    }
    if (uniteManquante(c.unite)) { laisser("UNITE_CATALOGUE", "unité du catalogue non renseignée : renseignez-la sur la fiche de l'article, l'article du restaurant sera créé ensuite"); continue; }
    const designation = c.nomCourt?.trim() || c.designation.trim();
    const cree = { id: `nouveau:${c.id}`, designation, espace, unite: c.unite!.trim(), actif: true, articleStockId: c.id, rattacheA: c.designation };
    etat.push(cree);
    decisions.push({ action: "CREER", articleStockId: c.id, designation, unite: cree.unite, categorie: c.categorie?.trim() || CATEGORIE_A_CLASSER, espace });
  }
  return decisions;
}
