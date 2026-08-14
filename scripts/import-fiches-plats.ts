/**
 * Import du classeur RÉEL des fiches techniques de la Direction
 * (« Fiche technique plats crash test.xlsx ») dans le module Stock :
 *   - onglet « Liste des articles » → `ArticleStock` (109 vrais articles) ;
 *   - 29 onglets de plats + 5 sous-recettes → `FicheTechnique` + `IngredientFiche`.
 *
 * DOCTRINE (identique à celle du moteur de coût, src/lib/fiches/cout.ts) :
 *
 *  1. **Ancrage sur les LIBELLÉS de la colonne B, jamais sur des coordonnées de cellule.**
 *     Les 30 onglets réels n'ont PAS la même mise en page : le tableau d'ingrédients commence
 *     ligne 21 sur « Bisque de cossas », ligne 31 sur « Sauté de blanc de poulet ». Un import
 *     ancré sur « C15 » se décale en silence et produit des nombres faux.
 *
 *  2. **`rendementUnite` vaut TOUJOURS "g".** Le rendement d'une sous-recette est lu dans son nom
 *     (« Sauce bolognaise 4.6 kg » → 4600) et converti en grammes AVANT écriture. Écrire « kg »
 *     ferait basculer, via `uniteRendementIncoherente`, toutes les fiches qui l'utilisent en coût
 *     indéterminé (le moteur refuse un rendement en kg consommé en g/cl).
 *
 *  3. **Aucun rattachement deviné.** Un ingrédient dont la désignation ne correspond à AUCUN
 *     article ni à AUCUNE sous-recette est SIGNALÉ dans le rapport, jamais rattaché « au plus
 *     proche » : un rattachement inventé produit un coût faux qui a l'air juste.
 *
 *  4. **Signale, ne corrige pas.** Les lignes où `prix unitaire × quantité par paquet ≠ prix
 *     carton` sont des erreurs de saisie de la Direction : elles sont listées, jamais corrigées.
 *     Le prix de vérité est le prix à l'unité (le prix carton est dérivé et n'est pas utilisé par
 *     le moteur de coût).
 *
 * IDEMPOTENCE : `ArticleStock` n'a pas de champ « note ». Le marqueur est donc la CLÉ NATURELLE :
 * l'import se considère déjà fait dès qu'une `FicheTechnique` porte l'un des noms lus dans le
 * classeur. `--force` supprime d'abord CES fiches-là (leurs ingrédients suivent en cascade) puis
 * réimporte ; les fiches saisies à la main hors classeur ne sont jamais touchées. Les articles
 * sont upsertés par désignation normalisée — naturellement idempotents, jamais supprimés.
 *
 * Usage :
 *   npx tsx scripts/import-fiches-plats.ts --dry-run                  (rapport seul, AUCUNE base)
 *   npx tsx scripts/import-fiches-plats.ts "postgresql://..." [--force] ["/chemin/classeur.xlsx"]
 *   (ou IMPORT_DATABASE_URL=postgresql://... npx tsx scripts/import-fiches-plats.ts)
 *
 * JAMAIS de défaut vers la prod : hors `--dry-run`, la DATABASE_URL doit être fournie
 * explicitement (argument positionnel ou IMPORT_DATABASE_URL). Le `.env` du dépôt pointe la
 * PRODUCTION et n'est volontairement pas lu ici.
 */
import * as XLSX from "xlsx";
import Decimal from "decimal.js";
import { facteur, normaliserUnite, poidsEmballage } from "../src/lib/fiches/conversion";
import { calculerCout, type FicheCalc, type IngredientCalc } from "../src/lib/fiches/cout";

const CHEMIN_PAR_DEFAUT = "/Users/sachatshiongo/Downloads/Tableurs/Fiche technique plats crash test.xlsx";
const ONGLET_ARTICLES = "Liste des articles";

/** Précision des colonnes Decimal du schéma — l'import arrondit EXPLICITEMENT et le signale. */
const DECIMALES_PRIX = 4; // ArticleStock.prixUnitaireUSD / prixCartonUSD : Decimal(12,4)
const DECIMALES_QUANTITE = 3; // IngredientFiche.quantite : Decimal(14,3)

// ─── Normalisation ───────────────────────────────────────────────────────────

/**
 * Clé de rapprochement d'une désignation : NFKD, diacritiques retirés, minuscules, espaces
 * (y compris insécables et retours ligne) réduits à un seul, trim. Les collisions de clé entre
 * deux désignations RÉELLEMENT différentes sont signalées, jamais fusionnées en silence.
 */
export function normaliserDesignation(texte: string): string {
  return texte
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diacritiques combinants issus de la décomposition NFKD
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Clé d'un libellé de structure : comme une désignation, moins la ponctuation de fin (« : »). */
function normaliserLibelle(texte: string): string {
  return normaliserDesignation(texte).replace(/[\s:.…]+$/, "");
}

const LIBELLES_CONNUS = new Set([
  "fiche technique",
  "nombre de portions",
  "prix de vente ttc",
  "taux tva",
  "article",
  "total prix de revient ht",
  "prix de revient unitaire ht par portion produite",
  "prix de revient unitaire ht par portion vendue",
  "coefficient de marge",
  "taux de marge",
  "prix de vente ht",
  "marge brute",
  "recette",
]);

// ─── Rendement lu dans le nom de la fiche ────────────────────────────────────

// « Sauce bolognaise 4.6 kg », « Coulis de tomate 1kg » : quantité + unité EN FIN de nom.
const RENDEMENT_REGEX = /\s*(\d+(?:[.,]\d+)?)\s*(kg|kgs|g|gr|grammes?|l|litres?|cl|ml)\s*$/i;

const RENDEMENT_VERS_G: Record<string, number> = {
  kg: 1000, kgs: 1000, g: 1, gr: 1, gramme: 1, grammes: 1,
  // Volume : le moteur de coût pose explicitement « le cl d'une sous-recette est un GRAMME,
  // densité 1 ». On applique CETTE convention maison (et le rapport la signale si elle sert),
  // on n'invente pas une densité.
  l: 1000, litre: 1000, litres: 1000, cl: 10, ml: 1,
};

export type Rendement = {
  /** Nom débarrassé du suffixe de rendement (« Sauce bolognaise »). */
  nom: string;
  /** Rendement en GRAMMES (jamais en kg/L/cl), ou `null` si le nom n'en porte pas. */
  quantiteG: number | null;
  /** Unité telle qu'écrite par la Direction, pour le rapport (« kg », « cl »…). */
  uniteSource: string | null;
};

/**
 * Extrait le rendement du nom d'une sous-recette et le rend EN GRAMMES.
 * `rendementUnite` en base vaut toujours "g" : c'est le seul moyen que le moteur de coût
 * accepte une consommation en g ou en cl sans la déclarer incohérente.
 */
export function extraireRendement(nomBrut: string): Rendement {
  const nom = nomBrut.replace(/\s+/g, " ").trim();
  const m = nom.match(RENDEMENT_REGEX);
  if (!m) return { nom, quantiteG: null, uniteSource: null };

  const uniteSource = m[2]!.toLowerCase();
  const facteurG = RENDEMENT_VERS_G[uniteSource];
  if (facteurG === undefined) return { nom, quantiteG: null, uniteSource: null };

  const quantite = new Decimal(m[1]!.replace(",", ".")).times(facteurG);
  return {
    nom: nom.slice(0, nom.length - m[0]!.length).trim(),
    quantiteG: quantite.toNumber(),
    uniteSource,
  };
}

// ─── Types du parseur ────────────────────────────────────────────────────────

export type Anomalie = { onglet: string; ligne: number; raison: string };

export type LigneArticle = {
  ligne: number;
  designation: string;
  cle: string;
  /** Colonne R « BARCODE » : lue mais NON importée (colonne non fiable, cf. rapport). */
  codeBarresBrut: string | null;
  unite: string | null;
  /** Colonne U : `null` quand elle contient autre chose qu'un nombre (le classeur y met parfois une catégorie). */
  uniteParCarton: number | null;
  uniteParCartonBrut: string | null;
  prixUnitaireUSD: number | null;
  prixCartonUSD: number | null;
  fournisseur: string | null;
};

export type EcartPrix = {
  ligne: number;
  designation: string;
  prixUnitaire: number;
  uniteParCarton: number;
  prixCartonSaisi: number;
  prixCartonAttendu: number;
  /** Rapport prixCartonSaisi / (prixUnitaire × uniteParCarton) — 10 pour les pennes. */
  rapport: number;
  /**
   * Constat FACTUEL (aucune correction) : quand le rapport vaut exactement le poids d'un paquet,
   * l'écart s'explique par un prix saisi au gramme face à un prix carton au carton. Sinon, rien
   * ne l'explique et le prix à l'unité est réellement suspect.
   */
  rapportEgalePoidsPaquet: boolean;
};

export type IngredientParse = {
  ligne: number;
  designation: string;
  cle: string;
  unite: string;
  /** `null` quand la colonne D est vide : quantité ABSENTE du classeur, pas « zéro ». */
  quantite: number | null;
  ordre: number;
};

export type FicheParsee = {
  onglet: string;
  /** Nom retenu (B13 nettoyé de son suffixe de rendement). */
  nom: string;
  nomBrut: string;
  /** Clés sous lesquelles une autre fiche peut la citer : nom d'onglet ET nom nettoyé. */
  cles: string[];
  categorie: string | null;
  nbPortions: number | null;
  prixVenteTTC: number | null;
  tauxTVA: number | null;
  coefficientMargeCible: number | null;
  recette: string | null;
  rendementQuantiteG: number | null;
  rendementUniteSource: string | null;
  estSousRecette: boolean;
  ingredients: IngredientParse[];
};

export type Rattachement =
  | { type: "ARTICLE"; article: LigneArticle }
  | { type: "SOUS_RECETTE"; fiche: FicheParsee }
  | { type: "AUCUN" };

export type LigneRattachee = {
  fiche: FicheParsee;
  ingredient: IngredientParse;
  rattachement: Rattachement;
};

export type UniteInconvertible = {
  uniteConsommation: string;
  uniteArticle: string;
  article: string;
  occurrences: { fiche: string; ligne: number }[];
};

export type ArrondiSignale = {
  quoi: string;
  valeurClasseur: string;
  valeurBase: string;
  ecartRelatif: number;
};

export type ResultatParse = {
  /** Articles DISTINCTS (après clé de rapprochement) : c'est ce qui part en base. */
  articles: LigneArticle[];
  /** Lignes du tableau retenues avant déduplication (109 dans le classeur de référence). */
  nbLignesArticlesRetenues: number;
  faussesLignesArticles: LigneArticle[];
  collisionsArticles: { cle: string; designations: string[] }[];
  ecartsPrix: EcartPrix[];
  fiches: FicheParsee[];
  sousRecettes: FicheParsee[];
  plats: FicheParsee[];
  lignes: LigneRattachee[];
  nonRattaches: LigneRattachee[];
  unitesInconvertibles: UniteInconvertible[];
  sousRecettesSansRendement: FicheParsee[];
  quantitesAbsentes: LigneRattachee[];
  arrondis: ArrondiSignale[];
  anomalies: Anomalie[];
  fournisseurs: string[];
};

// ─── Lecture bas niveau ──────────────────────────────────────────────────────

function valeur(ws: XLSX.WorkSheet, col: number, ligne: number): unknown {
  return ws[XLSX.utils.encode_cell({ r: ligne - 1, c: col })]?.v;
}

function texte(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

function nombre(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").trim());
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

function arrondir(v: number, decimales: number): Decimal {
  return new Decimal(v).toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);
}

/** Signale un arrondi de schéma qui déplace la valeur de plus de 0,1 % (jamais silencieux). */
function noterArrondi(liste: ArrondiSignale[], quoi: string, brut: number, decimales: number): Decimal {
  const arrondi = arrondir(brut, decimales);
  const source = new Decimal(brut);
  if (!source.equals(arrondi) && !source.isZero()) {
    const ecart = arrondi.minus(source).div(source.abs()).toNumber();
    if (Math.abs(ecart) > 0.001) {
      liste.push({ quoi, valeurClasseur: source.toString(), valeurBase: arrondi.toString(), ecartRelatif: ecart });
    }
  }
  return arrondi;
}

// ─── Onglet « Liste des articles » ───────────────────────────────────────────

type ColonnesArticles = {
  ligneEntete: number;
  barcode: number | null;
  designation: number;
  unite: number | null;
  uniteParCarton: number | null;
  prixUnitaire: number | null;
  prixCarton: number | null;
  fournisseur: number | null;
};

/**
 * Localise l'entête du tableau des articles par ses LIBELLÉS (« Désignation », « PRIX à l'unité »…)
 * et non par les colonnes R..X : une colonne insérée par la Direction décalerait tout en silence.
 * L'entête « Fournisseur » de la liste des FOURNISSEURS (colonne B) partage son libellé avec la
 * colonne X des articles : seules les colonnes situées à droite de « Désignation » sont retenues.
 */
export function localiserColonnesArticles(ws: XLSX.WorkSheet): ColonnesArticles | null {
  const ref = ws["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);

  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 60); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = ws[XLSX.utils.encode_cell({ r, c })]?.v;
      if (v === undefined || normaliserLibelle(String(v)) !== "designation") continue;

      const ligneEntete = r + 1;
      const entetes = new Map<string, number>();
      for (let cc = c; cc <= range.e.c; cc++) {
        const t = ws[XLSX.utils.encode_cell({ r, c: cc })]?.v;
        if (t === undefined) continue;
        const cle = normaliserLibelle(String(t));
        if (!entetes.has(cle)) entetes.set(cle, cc);
      }
      const gauche = ws[XLSX.utils.encode_cell({ r, c: c - 1 })]?.v;
      const barcode = gauche !== undefined && normaliserLibelle(String(gauche)) === "barcode" ? c - 1 : null;

      return {
        ligneEntete,
        barcode,
        designation: c,
        unite: entetes.get("unite") ?? null,
        uniteParCarton: entetes.get("quantite par paquet") ?? null,
        prixUnitaire: entetes.get("prix a l'unite") ?? entetes.get("prix a l unite") ?? null,
        prixCarton: entetes.get("prix crt") ?? null,
        fournisseur: entetes.get("fournisseur") ?? null,
      };
    }
  }
  return null;
}

/** Lit toutes les lignes du tableau des articles (sans encore écarter les fausses lignes). */
export function lireListeArticles(wb: XLSX.WorkBook): { lignes: LigneArticle[]; anomalies: Anomalie[] } {
  const anomalies: Anomalie[] = [];
  const ws = wb.Sheets[ONGLET_ARTICLES];
  if (!ws || !ws["!ref"]) {
    anomalies.push({ onglet: ONGLET_ARTICLES, ligne: 0, raison: "Onglet introuvable dans le classeur." });
    return { lignes: [], anomalies };
  }

  const cols = localiserColonnesArticles(ws);
  if (!cols) {
    anomalies.push({ onglet: ONGLET_ARTICLES, ligne: 0, raison: "Entête « Désignation » introuvable : structure du classeur modifiée." });
    return { lignes: [], anomalies };
  }
  for (const [nom, col] of [
    ["Unité", cols.unite], ["Quantité par paquet", cols.uniteParCarton],
    ["PRIX à l'unité", cols.prixUnitaire], ["PRIX CRT", cols.prixCarton], ["FOURNISSEUR", cols.fournisseur],
  ] as const) {
    if (col === null) anomalies.push({ onglet: ONGLET_ARTICLES, ligne: cols.ligneEntete, raison: `Colonne « ${nom} » introuvable dans l'entête.` });
  }

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const lignes: LigneArticle[] = [];

  for (let l = cols.ligneEntete + 1; l <= range.e.r + 1; l++) {
    const designation = texte(valeur(ws, cols.designation, l));
    if (!designation) continue; // trou dans la liste : ce n'est pas une fin de tableau

    const uBrut = cols.uniteParCarton === null ? undefined : valeur(ws, cols.uniteParCarton, l);
    const uNombre = nombre(uBrut);

    lignes.push({
      ligne: l,
      designation,
      cle: normaliserDesignation(designation),
      codeBarresBrut: cols.barcode === null ? null : texte(valeur(ws, cols.barcode, l)),
      unite: cols.unite === null ? null : texte(valeur(ws, cols.unite, l)),
      uniteParCarton: uNombre,
      uniteParCartonBrut: uNombre === null ? texte(uBrut) : null,
      prixUnitaireUSD: cols.prixUnitaire === null ? null : nombre(valeur(ws, cols.prixUnitaire, l)),
      prixCartonUSD: cols.prixCarton === null ? null : nombre(valeur(ws, cols.prixCarton, l)),
      fournisseur: cols.fournisseur === null ? null : texte(valeur(ws, cols.fournisseur, l)),
    });
  }

  return { lignes, anomalies };
}

// « 219 LASAGNE SEMOLA 12 X 500G », « 20 PENNE RIGATE LM CHEF 12 X 1KG » : conditionnement écrit
// dans la désignation par la Direction. Lu tel quel, uniquement pour EXPLIQUER un écart de prix.
const CONDITIONNEMENT_REGEX = /(\d+)\s*[Xx]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr)\b/i;

/** Poids d'un paquet en grammes, lu dans l'unité (« 500 GR ») puis dans la désignation. */
function poidsPaquetEnGrammes(a: LigneArticle): Decimal | null {
  const parUnite = a.unite === null ? null : poidsEmballage(a.unite);
  if (parUnite !== null) return parUnite.times(1000);

  const m = a.designation.match(CONDITIONNEMENT_REGEX);
  if (!m) return null;
  const facteurG = m[3]!.toLowerCase() === "kg" ? 1000 : 1;
  return new Decimal(m[2]!.replace(",", ".")).times(facteurG);
}

/**
 * Écarts « prix unitaire × quantité par paquet ≠ prix carton ». SIGNALÉS, jamais corrigés :
 * ce sont des erreurs de saisie de la Direction, et le prix de vérité est le prix à l'unité.
 */
export function detecterEcartsPrix(lignes: LigneArticle[]): EcartPrix[] {
  const ecarts: EcartPrix[] = [];
  for (const a of lignes) {
    if (a.prixUnitaireUSD === null || a.uniteParCarton === null || a.prixCartonUSD === null) continue;
    if (a.prixUnitaireUSD <= 0 || a.uniteParCarton <= 0 || a.prixCartonUSD <= 0) continue;

    const attendu = new Decimal(a.prixUnitaireUSD).times(a.uniteParCarton);
    const saisi = new Decimal(a.prixCartonUSD);
    const tolerance = Decimal.max(new Decimal("0.01"), saisi.abs().times("0.001"));
    if (saisi.minus(attendu).abs().lessThanOrEqualTo(tolerance)) continue;

    const rapport = saisi.div(attendu);
    const poidsG = poidsPaquetEnGrammes(a);

    ecarts.push({
      ligne: a.ligne,
      designation: a.designation,
      prixUnitaire: a.prixUnitaireUSD,
      uniteParCarton: a.uniteParCarton,
      prixCartonSaisi: a.prixCartonUSD,
      prixCartonAttendu: attendu.toDecimalPlaces(6).toNumber(),
      rapport: rapport.toDecimalPlaces(4).toNumber(),
      rapportEgalePoidsPaquet: poidsG !== null && rapport.minus(poidsG).abs().lessThanOrEqualTo("0.5"),
    });
  }
  return ecarts;
}

// ─── Onglets de fiches ───────────────────────────────────────────────────────

/** Index des libellés de structure de la colonne B → n° de ligne (1ʳᵉ occurrence). */
function indexerLibelles(ws: XLSX.WorkSheet, colB: number, range: XLSX.Range): Map<string, number> {
  const index = new Map<string, number>();
  for (let r = range.s.r; r <= range.e.r; r++) {
    const v = ws[XLSX.utils.encode_cell({ r, c: colB })]?.v;
    if (v === undefined || v === null) continue;
    const cle = normaliserLibelle(String(v));
    if (LIBELLES_CONNUS.has(cle) && !index.has(cle)) index.set(cle, r + 1);
  }
  return index;
}

// Colonnes des onglets de fiches. E (« Coût d'achat HT à l'unité ») et F (« Prix de revient HT »)
// sont des RÉSULTATS recopiés par la Direction : jamais importés, le moteur les recalcule.
const COL_B = 1, COL_C = 2, COL_D = 3, COL_F = 5;

/**
 * Lit un onglet de fiche technique en s'ancrant EXCLUSIVEMENT sur les libellés de la colonne B.
 * Le nom est le dernier texte libre avant « Nombre de portions : », la catégorie celui d'avant
 * (absente sur certaines fiches) — c'est ce qui rend l'import insensible aux lignes insérées.
 */
export function lireFiche(wb: XLSX.WorkBook, onglet: string): { fiche: FicheParsee | null; anomalies: Anomalie[] } {
  const anomalies: Anomalie[] = [];
  const ws = wb.Sheets[onglet];
  if (!ws || !ws["!ref"]) {
    anomalies.push({ onglet, ligne: 0, raison: "Onglet introuvable ou vide." });
    return { fiche: null, anomalies };
  }
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const libelles = indexerLibelles(ws, COL_B, range);

  const lFiche = libelles.get("fiche technique");
  const lPortions = libelles.get("nombre de portions");
  const lArticle = libelles.get("article");
  const lTotal = libelles.get("total prix de revient ht");
  for (const [nom, l] of [
    ["FICHE TECHNIQUE", lFiche], ["Nombre de portions :", lPortions],
    ["Article", lArticle], ["Total prix de revient HT", lTotal],
  ] as const) {
    if (l === undefined) anomalies.push({ onglet, ligne: 0, raison: `Libellé « ${nom} » introuvable en colonne B : onglet ignoré.` });
  }
  if (lFiche === undefined || lPortions === undefined || lArticle === undefined || lTotal === undefined) {
    return { fiche: null, anomalies };
  }

  // Titre : textes libres entre « FICHE TECHNIQUE » et « Nombre de portions : ».
  const entete: string[] = [];
  for (let l = lFiche + 1; l < lPortions; l++) {
    const t = texte(valeur(ws, COL_B, l));
    if (t) entete.push(t);
  }
  if (entete.length === 0) {
    anomalies.push({ onglet, ligne: lFiche, raison: "Aucun nom de fiche entre « FICHE TECHNIQUE » et « Nombre de portions : » : onglet ignoré." });
    return { fiche: null, anomalies };
  }
  const nomBrut = entete[entete.length - 1]!;
  const categorie = entete.length >= 2 ? entete[entete.length - 2]! : null;

  const rendement = extraireRendement(nomBrut);

  const lTVA = libelles.get("taux tva");
  const lTTC = libelles.get("prix de vente ttc");
  const lCoef = libelles.get("coefficient de marge");
  const lRecette = libelles.get("recette");

  // Recette : texte libre sous le libellé « Recette » (vide dans le classeur actuel).
  let recette: string | null = null;
  if (lRecette !== undefined) {
    const morceaux: string[] = [];
    for (let l = lRecette + 1; l <= range.e.r + 1; l++) {
      const t = texte(valeur(ws, COL_B, l));
      if (t && !LIBELLES_CONNUS.has(normaliserLibelle(t))) morceaux.push(t);
    }
    recette = morceaux.length ? morceaux.join("\n") : null;
  }

  // Ingrédients : lignes entre l'entête « Article » et « Total prix de revient HT ».
  const ingredients: IngredientParse[] = [];
  for (let l = lArticle + 1; l < lTotal; l++) {
    const designation = texte(valeur(ws, COL_B, l));
    if (!designation) {
      const q = nombre(valeur(ws, COL_D, l));
      const cout = nombre(valeur(ws, COL_F, l));
      if ((q !== null && q > 0) || (cout !== null && cout > 0)) {
        anomalies.push({ onglet, ligne: l, raison: "Ligne d'ingrédient sans désignation mais porteuse d'une quantité ou d'un coût : ignorée." });
      }
      continue; // ligne de remplissage du classeur (C=0, E=0, F=0)
    }
    const uniteBrute = texte(valeur(ws, COL_C, l));
    if (!uniteBrute) {
      anomalies.push({ onglet, ligne: l, raison: `Ingrédient « ${designation} » sans unité de consommation (colonne C).` });
    }
    ingredients.push({
      ligne: l,
      designation,
      cle: normaliserDesignation(designation),
      unite: uniteBrute ?? "",
      quantite: nombre(valeur(ws, COL_D, l)),
      ordre: ingredients.length,
    });
  }

  const nbPortions = nombre(valeur(ws, COL_C, lPortions));
  if (nbPortions === null || !(nbPortions > 0)) {
    anomalies.push({ onglet, ligne: lPortions, raison: "Nombre de portions absent ou nul : la fiche sera créée à 1 portion (valeur par défaut du schéma) — à corriger." });
  }

  return {
    fiche: {
      onglet,
      nom: rendement.nom || nomBrut,
      nomBrut,
      cles: [...new Set([normaliserDesignation(onglet), normaliserDesignation(rendement.nom || nomBrut), normaliserDesignation(nomBrut)])],
      categorie,
      nbPortions,
      prixVenteTTC: lTTC === undefined ? null : nombre(valeur(ws, COL_C, lTTC)),
      tauxTVA: lTVA === undefined ? null : nombre(valeur(ws, COL_C, lTVA)),
      coefficientMargeCible: lCoef === undefined ? null : nombre(valeur(ws, COL_F, lCoef)),
      recette,
      rendementQuantiteG: rendement.quantiteG,
      rendementUniteSource: rendement.uniteSource,
      estSousRecette: false, // déterminé plus bas, par les références croisées
      ingredients,
    },
    anomalies,
  };
}

// ─── Assemblage : parsing complet du classeur (aucune base) ──────────────────

/**
 * Une fiche est une SOUS-RECETTE lorsqu'une autre fiche la cite comme ingrédient. C'est la
 * définition métier, elle se lit dans le classeur : aucune liste codée en dur à maintenir.
 */
function marquerSousRecettes(fiches: FicheParsee[]): void {
  const parCle = new Map<string, FicheParsee>();
  for (const f of fiches) for (const c of f.cles) if (!parCle.has(c)) parCle.set(c, f);

  for (const f of fiches) {
    for (const i of f.ingredients) {
      const cible = parCle.get(i.cle);
      if (cible && cible !== f) cible.estSousRecette = true;
    }
  }
}

export function analyserClasseur(wb: XLSX.WorkBook): ResultatParse {
  const anomalies: Anomalie[] = [];
  const arrondis: ArrondiSignale[] = [];

  // 1. Fiches (tous les onglets sauf la liste des articles).
  const fiches: FicheParsee[] = [];
  for (const onglet of wb.SheetNames) {
    if (onglet === ONGLET_ARTICLES) continue;
    const { fiche, anomalies: a } = lireFiche(wb, onglet);
    anomalies.push(...a);
    if (fiche) fiches.push(fiche);
  }
  marquerSousRecettes(fiches);
  const sousRecettes = fiches.filter((f) => f.estSousRecette);
  const plats = fiches.filter((f) => !f.estSousRecette);

  // 2. Articles : les lignes qui portent le nom d'une fiche sont les « fausses lignes » du
  //    classeur (la Direction y a recopié ses sous-recettes pour s'en servir dans ses formules).
  const clesFiches = new Set(fiches.flatMap((f) => f.cles));
  const { lignes: toutesLignes, anomalies: aArticles } = lireListeArticles(wb);
  anomalies.push(...aArticles);

  const faussesLignesArticles = toutesLignes.filter((a) => clesFiches.has(a.cle));
  const retenues = toutesLignes.filter((a) => !clesFiches.has(a.cle));

  const articles: LigneArticle[] = [];
  const parCle = new Map<string, LigneArticle>();
  const collisions = new Map<string, string[]>();
  for (const a of retenues) {
    const existant = parCle.get(a.cle);
    if (existant) {
      const liste = collisions.get(a.cle) ?? [existant.designation];
      liste.push(a.designation);
      collisions.set(a.cle, liste);
      continue; // 1ʳᵉ occurrence conservée, la 2ᵉ signalée — jamais de fusion silencieuse
    }
    parCle.set(a.cle, a);
    articles.push(a);
    if (a.prixUnitaireUSD !== null) noterArrondi(arrondis, `Article « ${a.designation} » — prix à l'unité`, a.prixUnitaireUSD, DECIMALES_PRIX);
  }

  const ecartsPrix = detecterEcartsPrix(articles);

  // 3. Rattachement des ingrédients : sous-recette d'abord, puis article. Jamais « au plus proche ».
  const parCleFiche = new Map<string, FicheParsee>();
  for (const f of fiches) for (const c of f.cles) if (!parCleFiche.has(c)) parCleFiche.set(c, f);

  const lignes: LigneRattachee[] = [];
  for (const f of fiches) {
    for (const i of f.ingredients) {
      const sous = parCleFiche.get(i.cle);
      const article = parCle.get(i.cle);
      const rattachement: Rattachement =
        sous && sous !== f ? { type: "SOUS_RECETTE", fiche: sous }
        : article ? { type: "ARTICLE", article }
        : { type: "AUCUN" };
      lignes.push({ fiche: f, ingredient: i, rattachement });
      if (i.quantite !== null) {
        noterArrondi(arrondis, `${f.nom} › ${i.designation} — quantité`, i.quantite, DECIMALES_QUANTITE);
      }
    }
  }

  const nonRattaches = lignes.filter((l) => l.rattachement.type === "AUCUN");
  const quantitesAbsentes = lignes.filter((l) => l.ingredient.quantite === null);

  // 4. Unités qui ne se convertissent pas (`facteur` → null, et pas rattrapées par une
  //    unité-emballage type « 500 GR »). C'est ce qui chiffrera les lignes en « coût partiel ».
  const inconvertibles = new Map<string, UniteInconvertible>();
  for (const l of lignes) {
    if (l.rattachement.type !== "ARTICLE") continue;
    const uniteArticle = l.rattachement.article.unite;
    if (uniteArticle === null) {
      const cle = `${normaliserUnite(l.ingredient.unite)}→(sans unité)`;
      const e = inconvertibles.get(cle) ?? {
        uniteConsommation: l.ingredient.unite, uniteArticle: "(aucune)",
        article: l.rattachement.article.designation, occurrences: [],
      };
      e.occurrences.push({ fiche: l.fiche.nom, ligne: l.ingredient.ligne });
      inconvertibles.set(cle, e);
      continue;
    }
    if (facteur(l.ingredient.unite, uniteArticle) !== null) continue;
    const poids = poidsEmballage(uniteArticle);
    if (poids !== null && poids.greaterThan(0) && facteur(l.ingredient.unite, "kg") !== null) continue;

    const cle = `${normaliserUnite(l.ingredient.unite)}→${normaliserUnite(uniteArticle)}`;
    const e = inconvertibles.get(cle) ?? {
      uniteConsommation: l.ingredient.unite, uniteArticle,
      article: l.rattachement.article.designation, occurrences: [],
    };
    e.occurrences.push({ fiche: l.fiche.nom, ligne: l.ingredient.ligne });
    inconvertibles.set(cle, e);
  }

  const fournisseurs = [...new Set(articles.map((a) => a.fournisseur).filter((f): f is string => f !== null))].sort();

  return {
    articles,
    nbLignesArticlesRetenues: retenues.length,
    faussesLignesArticles,
    collisionsArticles: [...collisions].map(([cle, designations]) => ({ cle, designations })),
    ecartsPrix,
    fiches,
    sousRecettes,
    plats,
    lignes,
    nonRattaches,
    unitesInconvertibles: [...inconvertibles.values()],
    sousRecettesSansRendement: sousRecettes.filter((f) => f.rendementQuantiteG === null),
    quantitesAbsentes,
    arrondis,
    anomalies,
    fournisseurs,
  };
}

// ─── Simulation du moteur de coût (lecture seule, aucun accès base) ──────────

export type SimulationFiche = { nom: string; incomplet: boolean; motifs: string[]; coutParPortion: string | null };

/**
 * Passe le résultat du parsing dans le VRAI moteur (`calculerCout`) pour chiffrer, avant tout
 * import, combien de fiches sortiront en coût incomplet et pourquoi. Le moteur n'est pas modifié.
 */
export function simulerCouts(res: ResultatParse): SimulationFiche[] {
  const fichesCalc = new Map<string, FicheCalc>();
  const idDe = (f: FicheParsee) => f.onglet;

  for (const f of res.fiches) {
    const ingredients: IngredientCalc[] = res.lignes
      .filter((l) => l.fiche === f)
      .map((l) => {
        const base = { nom: l.ingredient.designation, unite: l.ingredient.unite, quantite: l.ingredient.quantite ?? 0 };
        if (l.rattachement.type === "ARTICLE") {
          return {
            ...base,
            article: {
              prixUnitaireUSD: l.rattachement.article.prixUnitaireUSD,
              unite: l.rattachement.article.unite ?? "",
            },
          };
        }
        if (l.rattachement.type === "SOUS_RECETTE") return { ...base, sousFicheId: idDe(l.rattachement.fiche) };
        return base; // non rattaché : le moteur dira SANS_SOURCE
      });

    fichesCalc.set(idDe(f), {
      id: idDe(f),
      nom: f.nom,
      nbPortions: f.nbPortions ?? 1,
      tauxTVA: f.tauxTVA ?? 0,
      prixVenteTTC: f.prixVenteTTC,
      coefficientMargeCible: f.coefficientMargeCible,
      estSousRecette: f.estSousRecette,
      rendementQuantite: f.rendementQuantiteG,
      rendementUnite: f.rendementQuantiteG === null ? null : "g",
      ingredients,
    });
  }

  const contexte = { fiches: fichesCalc };
  return res.fiches.map((f) => {
    const r = calculerCout(fichesCalc.get(idDe(f))!, contexte);
    return {
      nom: f.nom,
      incomplet: r.incomplet,
      motifs: r.ingredientsSansPrix,
      coutParPortion: r.incomplet && r.coutParPortion.isZero() ? null : r.coutParPortion.toDecimalPlaces(4).toString(),
    };
  });
}

// ─── Rapport ─────────────────────────────────────────────────────────────────

export function formaterRapport(res: ResultatParse, simulation: SimulationFiche[]): string {
  const out: string[] = [];
  let numero = 0;
  const bloc = (titre: string) => {
    numero++;
    return `\n${"─".repeat(78)}\n${numero}. ${titre}\n${"─".repeat(78)}`;
  };

  const nbIngredients = res.lignes.length;
  const parArticle = res.lignes.filter((l) => l.rattachement.type === "ARTICLE").length;
  const parSous = res.lignes.filter((l) => l.rattachement.type === "SOUS_RECETTE").length;

  out.push(bloc("VOLUMÉTRIE"));
  out.push(`Lignes d'articles retenues ......... ${res.nbLignesArticlesRetenues}`);
  out.push(`Articles distincts (→ base) ........ ${res.articles.length}${res.collisionsArticles.length > 0 ? `  (${res.nbLignesArticlesRetenues - res.articles.length} doublon(s) de désignation, cf. plus bas)` : ""}`);
  out.push(`Fausses lignes écartées ............ ${res.faussesLignesArticles.length} (${res.faussesLignesArticles.map((a) => a.designation).join(", ") || "aucune"})`);
  out.push(`Onglets de fiches .................. ${res.fiches.length}  (${res.sousRecettes.length} sous-recettes + ${res.plats.length} plats)`);
  out.push(`Ingrédients ........................ ${nbIngredients}  (${parArticle} → article, ${parSous} → sous-recette, ${res.nonRattaches.length} non rattachés)`);

  out.push(bloc("SOUS-RECETTES ET RENDEMENTS (rendementUnite = « g », toujours)"));
  for (const f of res.sousRecettes) {
    const rendu = f.rendementQuantiteG === null
      ? "RENDEMENT ABSENT — non déductible du nom"
      : `${f.rendementQuantiteG} g  (lu « ${f.rendementUniteSource} » dans « ${f.nomBrut} »)`;
    out.push(`  • ${f.nom.padEnd(24)} ${String(f.ingredients.length).padStart(2)} ingrédient(s) — ${rendu}`);
  }
  if (res.sousRecettesSansRendement.length > 0) {
    out.push("");
    out.push(`  /!\\ ${res.sousRecettesSansRendement.length} sous-recette(s) SANS rendement : leur nom ne porte aucune quantité.`);
    out.push("      Le moteur les rendra « coût indéterminé » chez toutes les fiches qui les utilisent.");
    out.push("      À TRANCHER par la Direction (aucune valeur n'est devinée ici) :");
    for (const f of res.sousRecettesSansRendement) {
      const utilisee = res.lignes.filter((l) => l.rattachement.type === "SOUS_RECETTE" && l.rattachement.fiche === f).map((l) => l.fiche.nom);
      out.push(`        - ${f.nom} → utilisée par : ${utilisee.join(", ") || "aucune fiche"}`);
    }
  }

  out.push(bloc("INGRÉDIENTS NON RATTACHÉS (jamais rattachés « au plus proche »)"));
  if (res.nonRattaches.length === 0) out.push("  Aucun : chaque ingrédient correspond à un article ou à une sous-recette.");
  for (const l of res.nonRattaches) {
    out.push(`  • ${l.fiche.nom} (L${l.ingredient.ligne}) : « ${l.ingredient.designation} » — ${l.ingredient.quantite ?? "?"} ${l.ingredient.unite}`);
  }

  out.push(bloc("ÉCARTS DE PRIX — prix unitaire × quantité par paquet ≠ prix carton (SIGNALÉS, NON CORRIGÉS)"));
  if (res.ecartsPrix.length === 0) out.push("  Aucun écart.");
  for (const e of res.ecartsPrix) {
    const cle = normaliserDesignation(e.designation);
    const fichesTouchees = [...new Set(
      res.lignes.filter((l) => l.rattachement.type === "ARTICLE" && l.rattachement.article.cle === cle).map((l) => l.fiche.nom)
    )];
    out.push(`  • L${e.ligne} ${e.designation}`);
    out.push(`      ${e.prixUnitaire} × ${e.uniteParCarton} = ${e.prixCartonAttendu} $ attendu, ${e.prixCartonSaisi} $ saisi (rapport ×${e.rapport})`);
    out.push(
      e.rapportEgalePoidsPaquet
        ? "      Le rapport vaut exactement le poids d'un paquet : prix saisi AU GRAMME face à un prix"
          + " CARTON.\n      Incohérence d'unité entre deux colonnes, pas de montant faux."
        : "      Aucune explication d'unité : le rapport ne correspond à aucun conditionnement."
          + " Le prix à l'unité\n      est donc réellement suspect — à confirmer par la Direction."
    );
    if (fichesTouchees.length > 0) {
      out.push(`      Utilisé par ${fichesTouchees.length} fiche(s) : ${fichesTouchees.join(", ")}`);
    }
  }
  out.push("  Le prix à l'unité est importé TEL QUEL (c'est lui qui fait foi pour le coût de revient) ;");
  out.push("  le prix carton est importé tel quel lui aussi et n'entre dans aucun calcul.");

  out.push(bloc("UNITÉS RENCONTRÉES QUI NE SE CONVERTISSENT PAS (→ coût partiel)"));
  const lignesInconvertibles = res.unitesInconvertibles.reduce((n, u) => n + u.occurrences.length, 0);
  if (res.unitesInconvertibles.length === 0) out.push("  Aucune : toutes les unités de consommation se convertissent vers l'unité d'achat.");
  for (const u of res.unitesInconvertibles) {
    out.push(`  • consommation « ${u.uniteConsommation} » contre unité d'achat « ${u.uniteArticle} » — article « ${u.article} »`);
    out.push(`      ${u.occurrences.length} ligne(s) : ${u.occurrences.map((o) => `${o.fiche} L${o.ligne}`).join(", ")}`);
  }
  out.push(`  TOTAL : ${lignesInconvertibles} ligne(s) sortiront en « coût partiel » pour motif d'unité.`);
  out.push("  QUESTION EN ATTENTE (non tranchée ici, seulement chiffrée) : les articles vendus en");
  out.push("  emballage (« 500 GR ») consommés à la pièce. Deux issues possibles côté Direction :");
  out.push("    a) saisir la consommation en g/kg → la conversion par poids d'emballage prend le relais ;");
  out.push("    b) déclarer l'unité d'achat « paquet » + un prix au paquet → conversion de comptage.");

  out.push(bloc("QUANTITÉS ABSENTES DU CLASSEUR"));
  if (res.quantitesAbsentes.length === 0) out.push("  Aucune.");
  for (const l of res.quantitesAbsentes) {
    out.push(`  • ${l.fiche.nom} (L${l.ingredient.ligne}) : « ${l.ingredient.designation} » — colonne « Unités nécessaires » vide`);
  }
  if (res.quantitesAbsentes.length > 0) {
    out.push("  Importées à 0 (le schéma n'accepte pas d'inconnue) : la ligne existe dans la recette,");
    out.push("  sa quantité est à saisir. Le classeur les comptait déjà 0.");
  }

  out.push(bloc("ARRONDIS IMPOSÉS PAR LE SCHÉMA (> 0,1 % d'écart)"));
  if (res.arrondis.length === 0) out.push("  Aucun.");
  for (const a of res.arrondis) {
    out.push(`  • ${a.quoi} : ${a.valeurClasseur} → ${a.valeurBase} (${(a.ecartRelatif * 100).toFixed(2)} %)`);
  }
  if (res.arrondis.length > 0) {
    out.push(`  Prix : ${DECIMALES_PRIX} décimales (Decimal(12,4)) — les articles tarifés « au gramme » touchent ce plancher.`);
    out.push(`  Quantités : ${DECIMALES_QUANTITE} décimales (Decimal(14,3)).`);
  }

  out.push(bloc("SIMULATION DU MOTEUR DE COÛT (src/lib/fiches/cout.ts, non modifié)"));
  const incompletes = simulation.filter((s) => s.incomplet);
  out.push(`  Fiches à coût complet ....... ${simulation.length - incompletes.length} / ${simulation.length}`);
  out.push(`  Fiches à coût incomplet ..... ${incompletes.length}`);
  for (const s of incompletes) {
    out.push(`  • ${s.nom} : ${s.motifs.join(" | ")}`);
  }

  if (res.collisionsArticles.length > 0) {
    out.push(bloc("COLLISIONS DE DÉSIGNATION (1ʳᵉ occurrence conservée, 2ᵉ ignorée)"));
    for (const c of res.collisionsArticles) out.push(`  • « ${c.cle} » ← ${c.designations.join(" / ")}`);
  }

  if (res.anomalies.length > 0) {
    out.push(bloc("ANOMALIES DE STRUCTURE"));
    for (const a of res.anomalies) out.push(`  • ${a.onglet}${a.ligne ? ` L${a.ligne}` : ""} : ${a.raison}`);
  }

  out.push(bloc("DONNÉES LUES MAIS VOLONTAIREMENT NON IMPORTÉES"));
  const barcodes = res.articles.filter((a) => a.codeBarresBrut !== null);
  const courts = barcodes.filter((a) => a.codeBarresBrut!.length < 8);
  out.push(`  • Colonne « BARCODE » : ${barcodes.length} valeur(s) sur ${res.articles.length} articles, dont ${courts.length} manifestement`);
  out.push(`    non-EAN (${courts.map((a) => a.codeBarresBrut).join(", ") || "—"}). Colonne non fiable → \`codeBarres\` laissé vide,`);
  out.push("    plutôt que de polluer la lecture code-barres du Stock.");
  const uTexte = res.articles.filter((a) => a.uniteParCartonBrut !== null);
  out.push(`  • Colonne « Quantité par paquet » non numérique sur ${uTexte.length} ligne(s) (une catégorie y a été saisie)`);
  out.push("    → `uniteParCarton` laissé vide sur ces lignes, aucun contrôle de prix carton possible.");
  out.push(`  • Colonne « FOURNISSEUR » : ${res.fournisseurs.length} nom(s) distinct(s) (${res.fournisseurs.join(", ") || "—"}).`);
  out.push("    Non rattachés : le référentiel Fournisseur du Stock fait foi, l'import ne le crée pas.");

  return out.join("\n");
}

// ─── Écriture en base ────────────────────────────────────────────────────────

async function ecrireEnBase(res: ResultatParse, databaseUrl: string, force: boolean): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    // ── Idempotence : marqueur = clé naturelle (les noms de fiches du classeur).
    const nomsClasseur = res.fiches.map((f) => f.nom);
    const dejaLa = await prisma.ficheTechnique.findMany({ where: { nom: { in: nomsClasseur } }, select: { id: true, nom: true } });
    if (dejaLa.length > 0) {
      if (!force) {
        console.log(
          `\nImport déjà effectué : ${dejaLa.length} fiche(s) du classeur existent déjà en base ` +
            `(${dejaLa.slice(0, 3).map((f) => f.nom).join(", ")}…). Aucune 2ᵉ importation ` +
            "(relance avec --force pour les supprimer puis réimporter)."
        );
        return;
      }
      console.log(`\n--force : suppression des ${dejaLa.length} fiche(s) déjà importée(s) (ingrédients en cascade)…`);
      await prisma.ficheTechnique.deleteMany({ where: { id: { in: dejaLa.map((f) => f.id) } } });
    }

    // ── 1. Articles : upsert par désignation normalisée.
    const existants = await prisma.articleStock.findMany({ select: { id: true, designation: true, domaine: true } });
    const idParCle = new Map<string, string>();
    const domaineParCle = new Map<string, string>();
    for (const a of existants) {
      const cle = normaliserDesignation(a.designation);
      if (!idParCle.has(cle)) { idParCle.set(cle, a.id); domaineParCle.set(cle, a.domaine); }
    }

    let crees = 0;
    let majs = 0;
    await prisma.$transaction(async (tx) => {
      for (const a of res.articles) {
        const donnees = {
          unite: a.unite,
          uniteParCarton: a.uniteParCarton === null ? null : arrondir(a.uniteParCarton, 2).toString(),
          prixUnitaireUSD: a.prixUnitaireUSD === null ? null : arrondir(a.prixUnitaireUSD, DECIMALES_PRIX).toString(),
          prixCartonUSD: a.prixCartonUSD === null ? null : arrondir(a.prixCartonUSD, DECIMALES_PRIX).toString(),
        };
        const id = idParCle.get(a.cle);
        if (id) {
          // `domaine` n'est JAMAIS réécrit : un article déjà classé BOISSON ne doit pas devenir
          // NOURRITURE parce qu'il figure aussi dans ce classeur.
          const domaine = domaineParCle.get(a.cle);
          if (domaine && domaine !== "NOURRITURE") {
            console.log(`  (i) « ${a.designation} » existe en domaine ${domaine} : domaine conservé.`);
          }
          await tx.articleStock.update({ where: { id }, data: donnees });
          majs++;
        } else {
          const cree = await tx.articleStock.create({ data: { designation: a.designation, domaine: "NOURRITURE", ...donnees } });
          idParCle.set(a.cle, cree.id);
          crees++;
        }
      }
    }, { timeout: 120_000 });
    console.log(`Articles : ${crees} créé(s), ${majs} mis à jour.`);

    // ── 2. Fiches : les SOUS-RECETTES d'abord (un plat peut en citer une), les plats ensuite.
    const idFiche = new Map<FicheParsee, string>();
    const ordreCreation = [...res.sousRecettes, ...res.plats];

    await prisma.$transaction(async (tx) => {
      for (const f of ordreCreation) {
        const cree = await tx.ficheTechnique.create({
          data: {
            nom: f.nom,
            categorie: f.categorie,
            type: "PLAT",
            nbPortions: f.nbPortions !== null && f.nbPortions > 0 ? Math.round(f.nbPortions) : 1,
            tauxTVA: f.tauxTVA === null ? undefined : arrondir(f.tauxTVA, 4).toString(),
            prixVenteTTC: f.prixVenteTTC === null ? null : arrondir(f.prixVenteTTC, DECIMALES_PRIX).toString(),
            coefficientMargeCible: f.coefficientMargeCible === null ? null : arrondir(f.coefficientMargeCible, 4).toString(),
            estSousRecette: f.estSousRecette,
            // TOUJOURS en grammes : « 4.6 kg » a été converti en 4600 g au parsing.
            rendementQuantite: f.rendementQuantiteG === null ? null : arrondir(f.rendementQuantiteG, 3).toString(),
            rendementUnite: f.rendementQuantiteG === null ? null : "g",
            recette: f.recette,
            actif: true,
          },
          select: { id: true },
        });
        idFiche.set(f, cree.id);
      }

      // ── 3. Ingrédients (lots) : jamais de rattachement deviné — les non rattachés sont écartés.
      const aInserer = res.lignes
        .filter((l) => l.rattachement.type !== "AUCUN")
        .map((l) => ({
          ficheId: idFiche.get(l.fiche)!,
          articleId: l.rattachement.type === "ARTICLE" ? idParCle.get(l.rattachement.article.cle)! : null,
          sousFicheId: l.rattachement.type === "SOUS_RECETTE" ? idFiche.get(l.rattachement.fiche)! : null,
          unite: l.ingredient.unite,
          quantite: arrondir(l.ingredient.quantite ?? 0, DECIMALES_QUANTITE).toString(),
          ordre: l.ingredient.ordre,
        }));

      const TAILLE_LOT = 500;
      for (let i = 0; i < aInserer.length; i += TAILLE_LOT) {
        await tx.ingredientFiche.createMany({ data: aInserer.slice(i, i + TAILLE_LOT) });
      }
      console.log(`Fiches : ${ordreCreation.length} créée(s) — Ingrédients : ${aInserer.length} créé(s).`);
      if (res.nonRattaches.length > 0) {
        console.log(`/!\\ ${res.nonRattaches.length} ingrédient(s) NON créé(s) faute de rattachement sûr (cf. §3 du rapport).`);
      }
    }, { timeout: 120_000 });
  } finally {
    await prisma.$disconnect();
  }
}

// ─── Exécution ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const positionnels = args.filter((a) => !a.startsWith("--"));
  // Une URL de base commence par « postgres… » : tout autre positionnel est un chemin de fichier.
  // Ainsi `--dry-run "/chemin/classeur.xlsx"` fonctionne sans jamais mentionner de base.
  const urls = positionnels.filter((p) => /^postgres(ql)?:\/\//i.test(p));
  const chemins = positionnels.filter((p) => !/^postgres(ql)?:\/\//i.test(p));
  const databaseUrl = urls[0] ?? process.env.IMPORT_DATABASE_URL;
  const cheminFichier = chemins[0] ?? CHEMIN_PAR_DEFAUT;

  console.log(`Fichier source : ${cheminFichier}`);
  console.log(`Mode : ${dryRun ? "MARCHE À VIDE (aucune écriture, aucune connexion)" : "IMPORT"}`);

  const wb = XLSX.readFile(cheminFichier, { cellFormula: false, cellHTML: false, cellStyles: false, bookDeps: false });
  const res = analyserClasseur(wb);
  console.log(formaterRapport(res, simulerCouts(res)));

  if (dryRun) return;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL manquante : passe-la en 1er argument (npx tsx scripts/import-fiches-plats.ts "postgresql://...") ' +
        "ou via IMPORT_DATABASE_URL, ou lance --dry-run. Aucun défaut vers la prod n'est fourni volontairement " +
        "(le .env du dépôt pointe la PRODUCTION)."
    );
  }
  console.log(`\nBase cible : ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`); // mot de passe masqué
  await ecrireEnBase(res, databaseUrl, force);
}

// Exécution directe uniquement (jamais lors d'un import par les tests du parseur).
if (process.argv[1] && process.argv[1].endsWith("import-fiches-plats.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
