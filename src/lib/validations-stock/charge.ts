// CHARGE DES DEMANDES À VALIDER (espace Stock) — module PUR : ni session, ni base.
//
// Une demande (`DemandeValidationStock`) porte, en JSON, ce qu'il faudra écrire si la Direction la
// valide. Le JSON n'est jamais lu « de confiance » : `lireCharge` le relit champ par champ et le
// refuse s'il ne correspond pas exactement au type de sa nature (une charge corrompue ou d'une
// version inconnue ne s'exécute pas — la Direction voit « demande illisible » et la refuse).
//
// Les nombres qui deviennent de l'argent ou une quantité de stock sont gardés en CHAÎNE décimale
// (« 12.5 ») et comparés avec Decimal : jamais d'aller-retour par un flottant.

import Decimal from "decimal.js";

/** Nombre → chaîne décimale en notation simple (« 0.0000001 », jamais « 1e-7 »), lisible par la charge. */
export const texteDecimal = (n: number): string => new Decimal(n).toFixed();

export type NatureDemande = "PAIEMENT_FACTURE" | "RECONCILIATION" | "MODIF_ARTICLE" | "MOUVEMENT_MANUEL";

export const NATURE_LIBELLE: Record<NatureDemande, string> = {
  PAIEMENT_FACTURE: "Paiements de factures",
  RECONCILIATION: "Réconciliations du stock",
  MODIF_ARTICLE: "Modifications d'articles",
  MOUVEMENT_MANUEL: "Entrées et sorties manuelles",
};

// ── Cibles (verrou « une demande en attente par cible », voir CibleDemandeStock) ──────────────
export const cleFacture = (id: string) => `FACTURE:${id}`;
export const cleArticle = (id: string) => `ARTICLE:${id}`;
export const cleComptage = (articleId: string) => `COMPTAGE:${articleId}`;
export const cleMouvement = (articleId: string) => `MOUVEMENT:${articleId}`;

// ── Paiement de facture ─────────────────────────────────────────────────────
/**
 * - SOLDE : « Marquer payée » d'UNE facture (paiement du reste à payer).
 * - LOT : « Marquer payées » de plusieurs factures, tout ou rien, à la même date.
 * - REGLEMENT : « + Paiement / Avoir » (partiel, en USD ou en francs), ou le montant réglé saisi à
 *   la création d'une facture.
 * `factures[].resteUSD` = le reste à payer VU par le demandeur : si la facture a bougé depuis
 * (payée ailleurs, avoir…), la validation le signale et refuse au lieu de payer autre chose.
 */
/**
 * Un règlement en FRANCS porte `montantCDF` et AUCUN montant en dollars ni taux : la conversion se
 * fait à la VALIDATION, au taux des Paramètres à ce moment-là — exactement comme le paiement direct
 * (décision de la Direction, 2026-10-01). En dollars : `montantUSD`, sans francs.
 */
export type ReglementDemande = {
  type: "PAIEMENT" | "AVOIR";
  montantUSD: string | null;
  montantCDF: string | null;
  taux: null;
  modePaiement: string | null;
  note: string | null;
};
/**
 * Facture d'une demande. En dollars (toutes les demandes d'avant le 2026-10-09) : `resteUSD`. En
 * francs : `devise` CDF et `resteCDF` (le reste VU, en francs — jeton comparé à la validation), sans
 * `resteUSD`.
 */
export type FactureDemande =
  | { id: string; fournisseurNom: string; numero: string | null; resteUSD: string; devise?: undefined; resteCDF?: undefined }
  | { id: string; fournisseurNom: string; numero: string | null; devise: "CDF"; resteCDF: string; resteUSD?: undefined };
export type ChargePaiement = {
  v: 1;
  mode: "SOLDE" | "LOT" | "REGLEMENT";
  date: string; // date de paiement proposée, AAAA-MM-JJ (la Direction peut la corriger)
  factures: FactureDemande[];
  reglement: ReglementDemande | null; // présent seulement pour REGLEMENT
  /**
   * LOT payé en FRANCS (2026-10-08) : chaque facture soldée par reste × taux francs, au taux des
   * Paramètres À LA VALIDATION (comme un règlement en francs). Absent = en dollars, comme avant.
   * (« Marquer payée » d'UNE facture en francs est un REGLEMENT avec `montantCDF`.)
   * Une facture tenue en francs d'un tel lot est soldée en francs, sans conversion.
   */
  enFrancs?: true;
  /** LOT payé « chaque facture dans sa devise » (2026-10-09) : aucune conversion, aucun taux. */
  saDevise?: true;
};

// ── Réconciliation (comptage) ───────────────────────────────────────────────
/** Une ligne comptée : `theorique` = stock du logiciel AU MOMENT DU COMPTAGE. */
export type LigneComptageDemande = {
  articleId: string;
  designation: string;
  unite: string | null;
  theorique: string;
  physique: string;
  explication: string;
  prixUnitaireUSD: string | null;
};
export type ChargeComptage = {
  v: 1;
  domaine: "NOURRITURE" | "BOISSON" | "AUTRE" | null;
  origine: string;
  lignes: LigneComptageDemande[];
};

// ── Modification d'article ──────────────────────────────────────────────────
export type Valeur = string | boolean | null;

/**
 * Champs d'un article qu'une proposition peut changer. `porte` = la table qui les tient
 * (ArticleStock ou sa ligne Stock). `sorte` décide de la comparaison (Decimal pour « decimal »).
 */
export const CHAMPS_ARTICLE = {
  code: { libelle: "Code", sorte: "texte", porte: "article" },
  designation: { libelle: "Désignation", sorte: "texte", porte: "article" },
  nomCourt: { libelle: "Nom court", sorte: "texte", porte: "article" },
  // Domaine (Nourriture / Boissons / Autre) — modifiable depuis le 2026-10-09 (demande de Sacha).
  domaine: { libelle: "Domaine", sorte: "texte", porte: "article" },
  unite: { libelle: "Unité", sorte: "texte", porte: "article" },
  contenance: { libelle: "Contenance", sorte: "decimal", porte: "article" },
  contenanceUnite: { libelle: "Unité de contenance", sorte: "texte", porte: "article" },
  // Prix de référence (2026-10-08) : sa devise, puis le prix dans CETTE devise (l'autre est nulle).
  devisePrix: { libelle: "Devise du prix", sorte: "texte", porte: "article" },
  prixUnitaireUSD: { libelle: "Prix unitaire USD", sorte: "decimal", porte: "article" },
  prixUnitaireCDF: { libelle: "Prix unitaire FC", sorte: "decimal", porte: "article" },
  uniteParCarton: { libelle: "Unités / carton", sorte: "decimal", porte: "article" },
  categorieId: { libelle: "Catégorie", sorte: "ref", porte: "article" },
  fournisseurId: { libelle: "Fournisseur", sorte: "ref", porte: "article" },
  actif: { libelle: "Actif", sorte: "booleen", porte: "article" },
  surFicheCommande: { libelle: "Sur la fiche commande", sorte: "booleen", porte: "article" },
  stockMinimum: { libelle: "Stock minimum", sorte: "decimal", porte: "stock" },
  seuilUrgent: { libelle: "Seuil urgent", sorte: "decimal", porte: "stock" },
  quantite: { libelle: "Quantité en stock", sorte: "decimal", porte: "stock" },
} as const;
export type ChampArticle = keyof typeof CHAMPS_ARTICLE;
export const LISTE_CHAMPS_ARTICLE = Object.keys(CHAMPS_ARTICLE) as ChampArticle[];
export const estChampArticle = (s: unknown): s is ChampArticle => typeof s === "string" && s in CHAMPS_ARTICLE;

/** Un changement proposé : valeur AVANT (vue par le demandeur) → APRÈS, avec leurs libellés lisibles. */
export type Changement = { champ: ChampArticle; avant: Valeur; apres: Valeur; avantLibelle: string; apresLibelle: string };
export type ArticleDemande = { id: string; designation: string; changements: Changement[] };
export type ChargeArticle = { v: 1; libelle: string; articles: ArticleDemande[] };

// ── Entrée / sortie manuelle ────────────────────────────────────────────────
/** Un mouvement manuel tel que saisi : appliqué tel quel (des quantités, pas un stock final). */
export type LigneMouvementDemande = { articleId: string; designation: string; unite: string | null; quantite: string; stockAvant: string; prixUnitaireUSD: string | null };
export type ChargeMouvement = {
  v: 1;
  type: "ENTREE" | "SORTIE";
  date: string; // instant ISO de la date du mouvement (comme le geste direct)
  origine: string;
  raisonSortie: string | null;
  lignes: LigneMouvementDemande[];
};

export type Charge = ChargePaiement | ChargeComptage | ChargeArticle | ChargeMouvement;

/** Domaines d'un article (enum `DomaineStock`) et leur libellé — jamais une autre valeur. */
export const DOMAINES_ARTICLE = ["NOURRITURE", "BOISSON", "AUTRE"] as const;
export type DomaineArticle = (typeof DOMAINES_ARTICLE)[number];
export const estDomaineArticle = (x: unknown): x is DomaineArticle => typeof x === "string" && (DOMAINES_ARTICLE as readonly string[]).includes(x);
const LIBELLE_DOMAINE: Record<string, string> = { NOURRITURE: "Nourriture", BOISSON: "Boissons", AUTRE: "Autre" };

/** Égalité de deux valeurs d'un champ : décimales comparées exactement (« 2.50 » = « 2.5 »). */
export function valeursEgales(champ: ChampArticle, a: Valeur, b: Valeur): boolean {
  if (a === null || b === null) return a === b;
  if (CHAMPS_ARTICLE[champ].sorte === "decimal") {
    try { return new Decimal(String(a)).equals(new Decimal(String(b))); } catch { return false; }
  }
  return a === b;
}

/** Libellé lisible d'une valeur (hors références, dont le nom est résolu par l'appelant). */
export function libelleValeur(champ: ChampArticle, v: Valeur): string {
  if (v === null || v === "") return "—";
  if (champ === "devisePrix") return v === "CDF" ? "francs (FC)" : v === "USD" ? "dollars ($)" : String(v);
  if (champ === "domaine") return LIBELLE_DOMAINE[String(v)] ?? String(v);
  const sorte = CHAMPS_ARTICLE[champ].sorte;
  if (sorte === "booleen") return v ? "Oui" : "Non";
  if (sorte === "decimal") {
    try { return new Decimal(String(v)).toString().replace(".", ","); } catch { return String(v); }
  }
  return String(v);
}

// ── Relecture validée ───────────────────────────────────────────────────────
class ChargeIllisible extends Error {
  constructor(detail: string) { super(`Demande illisible (${detail}) : elle ne peut pas être exécutée — refusez-la.`); }
}

const estObjet = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const chaine = (x: unknown, champ: string): string => { if (typeof x !== "string") throw new ChargeIllisible(champ); return x; };
const chaineOuNull = (x: unknown, champ: string): string | null => (x === null ? null : chaine(x, champ));
const decimale = (x: unknown, champ: string): string => {
  const s = chaine(x, champ);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new ChargeIllisible(champ);
  return s;
};
const decimaleOuNull = (x: unknown, champ: string): string | null => (x === null ? null : decimale(x, champ));
const liste = (x: unknown, champ: string): unknown[] => { if (!Array.isArray(x) || x.length === 0) throw new ChargeIllisible(champ); return x; };
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

function lirePaiement(o: Record<string, unknown>): ChargePaiement {
  if (o.mode !== "SOLDE" && o.mode !== "LOT" && o.mode !== "REGLEMENT") throw new ChargeIllisible("mode");
  const date = chaine(o.date, "date");
  if (!DATE_ISO.test(date)) throw new ChargeIllisible("date");
  const factures = liste(o.factures, "factures").map((f, i) => {
    if (!estObjet(f)) throw new ChargeIllisible(`facture ${i + 1}`);
    const base = { id: chaine(f.id, "facture.id"), fournisseurNom: chaine(f.fournisseurNom, "facture.fournisseurNom"), numero: chaineOuNull(f.numero, "facture.numero") };
    if (f.devise === "CDF") {
      if (f.resteUSD !== undefined) throw new ChargeIllisible("facture en francs avec un reste en dollars");
      return { ...base, devise: "CDF" as const, resteCDF: decimale(f.resteCDF, "facture.resteCDF") };
    }
    if (f.devise !== undefined || f.resteCDF !== undefined) throw new ChargeIllisible("facture.devise");
    return { ...base, resteUSD: decimale(f.resteUSD, "facture.resteUSD") };
  });
  let reglement: ReglementDemande | null = null;
  if (o.mode === "REGLEMENT") {
    const r = o.reglement;
    if (!estObjet(r) || (r.type !== "PAIEMENT" && r.type !== "AVOIR")) throw new ChargeIllisible("règlement");
    const montantUSD = decimaleOuNull(r.montantUSD, "règlement.montantUSD");
    const montantCDF = decimaleOuNull(r.montantCDF, "règlement.montantCDF");
    if ((montantUSD === null) === (montantCDF === null)) throw new ChargeIllisible("règlement : un montant en dollars OU en francs");
    if (r.taux !== null && r.taux !== undefined) throw new ChargeIllisible("règlement : le taux se lit à la validation");
    reglement = {
      type: r.type,
      montantUSD,
      montantCDF,
      taux: null,
      modePaiement: chaineOuNull(r.modePaiement, "règlement.modePaiement"),
      note: chaineOuNull(r.note, "règlement.note"),
    };
    if (factures.length !== 1) throw new ChargeIllisible("un règlement porte sur une seule facture");
  } else if (o.reglement !== null && o.reglement !== undefined) {
    throw new ChargeIllisible("règlement inattendu");
  }
  if (o.mode === "SOLDE" && factures.length !== 1) throw new ChargeIllisible("« marquer payée » porte sur une seule facture");
  if (o.enFrancs !== undefined && (o.enFrancs !== true || o.mode !== "LOT")) throw new ChargeIllisible("lot en francs");
  if (o.saDevise !== undefined && (o.saDevise !== true || o.mode !== "LOT" || o.enFrancs !== undefined)) throw new ChargeIllisible("lot dans la devise de chaque facture");
  return { v: 1, mode: o.mode, date, factures, reglement, ...(o.enFrancs === true ? { enFrancs: true as const } : {}), ...(o.saDevise === true ? { saDevise: true as const } : {}) };
}

function lireComptage(o: Record<string, unknown>): ChargeComptage {
  const d = o.domaine;
  if (d !== null && d !== "NOURRITURE" && d !== "BOISSON" && d !== "AUTRE") throw new ChargeIllisible("domaine");
  const lignes = liste(o.lignes, "lignes").map((l, i) => {
    if (!estObjet(l)) throw new ChargeIllisible(`ligne ${i + 1}`);
    return {
      articleId: chaine(l.articleId, "ligne.articleId"),
      designation: chaine(l.designation, "ligne.designation"),
      unite: chaineOuNull(l.unite, "ligne.unite"),
      theorique: decimale(l.theorique, "ligne.theorique"),
      physique: decimale(l.physique, "ligne.physique"),
      explication: chaine(l.explication, "ligne.explication"),
      prixUnitaireUSD: decimaleOuNull(l.prixUnitaireUSD, "ligne.prixUnitaireUSD"),
    };
  });
  return { v: 1, domaine: d, origine: chaine(o.origine, "origine"), lignes };
}

function lireValeur(champ: ChampArticle, x: unknown, quoi: string): Valeur {
  // La devise d'un prix n'a que deux valeurs (jamais nulle) : une autre ne s'exécute jamais.
  if (champ === "devisePrix" && x !== "USD" && x !== "CDF") throw new ChargeIllisible(quoi);
  // Le domaine n'a que trois valeurs (jamais nul) : une autre ne s'exécute jamais.
  if (champ === "domaine" && !estDomaineArticle(x)) throw new ChargeIllisible(quoi);
  if (x === null) return null;
  const sorte = CHAMPS_ARTICLE[champ].sorte;
  if (sorte === "booleen") { if (typeof x !== "boolean") throw new ChargeIllisible(quoi); return x; }
  if (sorte === "decimal") return decimale(x, quoi);
  return chaine(x, quoi);
}

function lireArticle(o: Record<string, unknown>): ChargeArticle {
  const articles = liste(o.articles, "articles").map((a, i) => {
    if (!estObjet(a)) throw new ChargeIllisible(`article ${i + 1}`);
    const changements = liste(a.changements, "changements").map((c) => {
      if (!estObjet(c) || !estChampArticle(c.champ)) throw new ChargeIllisible("champ inconnu");
      const champ = c.champ;
      return {
        champ,
        avant: lireValeur(champ, c.avant, `${champ} avant`),
        apres: lireValeur(champ, c.apres, `${champ} après`),
        avantLibelle: chaine(c.avantLibelle, "libellé"),
        apresLibelle: chaine(c.apresLibelle, "libellé"),
      };
    });
    if (new Set(changements.map((c) => c.champ)).size !== changements.length) throw new ChargeIllisible("champ en double");
    return { id: chaine(a.id, "article.id"), designation: chaine(a.designation, "article.designation"), changements };
  });
  if (new Set(articles.map((a) => a.id)).size !== articles.length) throw new ChargeIllisible("article en double");
  return { v: 1, libelle: chaine(o.libelle, "libellé"), articles };
}

function lireMouvement(o: Record<string, unknown>): ChargeMouvement {
  if (o.type !== "ENTREE" && o.type !== "SORTIE") throw new ChargeIllisible("type");
  const date = chaine(o.date, "date");
  if (Number.isNaN(new Date(date).getTime())) throw new ChargeIllisible("date");
  const lignes = liste(o.lignes, "lignes").map((l, i) => {
    if (!estObjet(l)) throw new ChargeIllisible(`ligne ${i + 1}`);
    const quantite = decimale(l.quantite, "ligne.quantite");
    if (!(Number(quantite) > 0)) throw new ChargeIllisible("quantité nulle ou négative");
    return {
      articleId: chaine(l.articleId, "ligne.articleId"), designation: chaine(l.designation, "ligne.designation"), unite: chaineOuNull(l.unite, "ligne.unite"),
      quantite, stockAvant: decimale(l.stockAvant, "ligne.stockAvant"), prixUnitaireUSD: decimaleOuNull(l.prixUnitaireUSD, "ligne.prixUnitaireUSD"),
    };
  });
  return { v: 1, type: o.type, date, origine: chaine(o.origine, "origine"), raisonSortie: chaineOuNull(o.raisonSortie, "raisonSortie"), lignes };
}

export function lireCharge(nature: "PAIEMENT_FACTURE", brut: unknown): ChargePaiement;
export function lireCharge(nature: "MOUVEMENT_MANUEL", brut: unknown): ChargeMouvement;
export function lireCharge(nature: "RECONCILIATION", brut: unknown): ChargeComptage;
export function lireCharge(nature: "MODIF_ARTICLE", brut: unknown): ChargeArticle;
export function lireCharge(nature: NatureDemande, brut: unknown): Charge;
/** Relit et VALIDE la charge d'une demande ; lève « Demande illisible » si elle n'est pas conforme. */
export function lireCharge(nature: NatureDemande, brut: unknown): Charge {
  if (!estObjet(brut) || brut.v !== 1) throw new ChargeIllisible("version");
  if (nature === "PAIEMENT_FACTURE") return lirePaiement(brut);
  if (nature === "RECONCILIATION") return lireComptage(brut);
  if (nature === "MOUVEMENT_MANUEL") return lireMouvement(brut);
  return lireArticle(brut);
}

/** Variante sans exception, pour l'affichage : `null` = illisible. */
export function lireChargeOuNull(nature: NatureDemande, brut: unknown): Charge | null {
  try { return lireCharge(nature, brut); } catch { return null; }
}

/**
 * Ajoute des changements à une proposition EN ATTENTE du même auteur sur le même article (une
 * seconde retouche avant la décision de la Direction) : le champ déjà proposé garde son AVANT
 * d'origine et prend le nouvel APRÈS ; un champ revenu à sa valeur d'avant disparaît. Renvoie la
 * liste fusionnée (vide = plus rien à proposer).
 */
export function fusionnerChangements(existants: Changement[], nouveaux: Changement[]): Changement[] {
  const parChamp = new Map(existants.map((c) => [c.champ, c]));
  for (const n of nouveaux) {
    const e = parChamp.get(n.champ);
    parChamp.set(n.champ, e ? { ...e, apres: n.apres, apresLibelle: n.apresLibelle } : n);
  }
  // Ordre canonique des champs (celui de la fiche), quel que soit l'ordre des retouches.
  return LISTE_CHAMPS_ARTICLE.flatMap((champ) => { const c = parChamp.get(champ); return c && !valeursEgales(champ, c.avant, c.apres) ? [c] : []; });
}
