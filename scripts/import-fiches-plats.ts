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
 * IDEMPOTENCE ET SÉCURITÉ DE `--force` : ni `ArticleStock` ni `FicheTechnique` n'ont de champ
 * « note », et `FicheTechnique.nom` n'a AUCUNE contrainte d'unicité. Le marqueur est donc la clé
 * naturelle (les noms du classeur) DOUBLÉE d'une empreinte de contenu :
 *   - « import déjà fait » exige que les fiches du classeur soient TOUTES en base ET toutes
 *     conformes — sinon une seule « Carbonara » saisie à la main ferait afficher « déjà importé »
 *     et n'importerait rien du tout, en silence ;
 *   - `--force` ne supprime que les fiches dont le contenu est IDENTIQUE à ce que l'import
 *     écrirait (suppression alors strictement neutre). Toute fiche homonyme divergente — donc
 *     potentiellement saisie ou corrigée à la main — bloque l'import et doit être autorisée
 *     nommément par `--supprimer "<nom>"`. Les noms du classeur sont des noms de carte ordinaires
 *     (Carbonara, Bolognaise, Crème brûlée) qu'un cuisinier ressaisira spontanément ;
 *   - la suppression se fait en ordre de dépendance (plats puis sous-recettes) :
 *     `IngredientFiche.sousFicheId` est en `onDelete: Restrict`, non déférable en PostgreSQL.
 *
 * ATTENTION — LES ARTICLES SONT ÉCRASÉS PAR LE CLASSEUR. Ils sont upsertés par désignation
 * normalisée (jamais supprimés), mais un prix corrigé DANS L'APPLICATION est ramené à la valeur
 * du classeur. Chaque valeur écrasée est listée avant/après en fin d'exécution ;
 * `--conserver-prix-existants` préserve les prix déjà en base.
 *
 * Usage :
 *   npx tsx scripts/import-fiches-plats.ts --dry-run                  (rapport seul, AUCUNE base)
 *   npx tsx scripts/import-fiches-plats.ts "postgresql://..." ["/chemin/classeur.xlsx"]
 *        [--force] [--supprimer "<nom de fiche>"]… [--conserver-prix-existants]
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

export type PrixInvraisemblable = {
  ligne: number;
  designation: string;
  unite: string;
  prixUnitaire: number;
  /** Grandeur de comparaison : « kg » (masse) ou « L » (volume). */
  grandeur: "kg" | "L";
  /** Prix ramené à l'unité de comparaison — c'est lui qui est aberrant. */
  prixRamene: number;
  /** Médiane des pairs de la même grandeur. */
  mediane: number;
  /** prixRamene / mediane : ~1/1000 = prix saisi au gramme sous une unité kg. */
  rapport: number;
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
  /** Tous les textes libres du bloc de titre, dans l'ordre — permet de relire l'interprétation. */
  textesEntete: string[];
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
  prixInvraisemblables: PrixInvraisemblable[];
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

/**
 * Prix ramené à l'unité de comparaison de sa grandeur (le kg pour une masse, le litre pour un
 * volume). `null` pour les unités de comptage (pièce, boîte, bouteille…) : deux « pièces » ne sont
 * pas comparables entre elles, on ne prétend pas le contraire.
 */
function prixRamene(a: LigneArticle): { grandeur: "kg" | "L"; valeur: Decimal } | null {
  if (a.unite === null || a.prixUnitaireUSD === null || !(a.prixUnitaireUSD > 0)) return null;
  const prix = new Decimal(a.prixUnitaireUSD);

  const versKg = facteur(a.unite, "kg") ?? poidsEmballage(a.unite);
  if (versKg !== null && versKg.greaterThan(0)) return { grandeur: "kg", valeur: prix.div(versKg) };

  const versL = facteur(a.unite, "l");
  if (versL !== null && versL.greaterThan(0)) return { grandeur: "L", valeur: prix.div(versL) };

  return null;
}

function mediane(valeurs: Decimal[]): Decimal | null {
  if (valeurs.length === 0) return null;
  const tri = [...valeurs].sort((x, y) => x.comparedTo(y));
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 === 1 ? tri[milieu]! : tri[milieu - 1]!.plus(tri[milieu]!).div(2);
}

/** Au-delà de ce rapport à la médiane des pairs, le prix n'est plus une variation de marché. */
const SEUIL_INVRAISEMBLANCE = 100;

/**
 * Vraisemblance du prix ramené à l'unité : repère les prix saisis dans une unité qui n'est pas
 * celle déclarée (« Sucre Blanc » à 0,00142 $ sous une unité « kg », soit 1,42 $ la tonne, alors
 * que son jumeau « Sucre Brun » est au gramme). Le contrôle `V×U ≠ W` ne peut PAS attraper cette
 * famille : elle ne met en jeu qu'une seule colonne de prix, et la quantité par paquet est souvent
 * du texte. SIGNALE, ne corrige pas : la médiane des pairs est un indice, pas une vérité.
 */
export function detecterPrixInvraisemblables(articles: LigneArticle[]): PrixInvraisemblable[] {
  const ramenes = articles
    .map((a) => ({ a, r: prixRamene(a) }))
    .filter((x): x is { a: LigneArticle; r: { grandeur: "kg" | "L"; valeur: Decimal } } => x.r !== null);

  const medianes = new Map<"kg" | "L", Decimal | null>([
    ["kg", mediane(ramenes.filter((x) => x.r.grandeur === "kg").map((x) => x.r.valeur))],
    ["L", mediane(ramenes.filter((x) => x.r.grandeur === "L").map((x) => x.r.valeur))],
  ]);

  const suspects: PrixInvraisemblable[] = [];
  for (const { a, r } of ramenes) {
    const med = medianes.get(r.grandeur);
    if (med === null || med === undefined || !med.greaterThan(0)) continue;
    const rapport = r.valeur.div(med);
    if (rapport.greaterThanOrEqualTo(SEUIL_INVRAISEMBLANCE) || rapport.lessThanOrEqualTo(new Decimal(1).div(SEUIL_INVRAISEMBLANCE))) {
      suspects.push({
        ligne: a.ligne,
        designation: a.designation,
        unite: a.unite!,
        prixUnitaire: a.prixUnitaireUSD!,
        grandeur: r.grandeur,
        prixRamene: r.valeur.toDecimalPlaces(6).toNumber(),
        mediane: med.toDecimalPlaces(4).toNumber(),
        rapport: rapport.toSignificantDigits(3).toNumber(),
      });
    }
  }
  return suspects.sort((x, y) => x.rapport - y.rapport);
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
  // Le bloc de titre du classeur contient 1 texte (nom seul) ou 2 (catégorie + nom). Au-delà, la
  // règle « le dernier texte est le nom » n'est plus garantie : une note ajoutée SOUS le titre
  // deviendrait le nom de la fiche, sans que rien ne le dise. On refuse le silence.
  if (entete.length > 2) {
    anomalies.push({
      onglet,
      ligne: lFiche,
      raison:
        `${entete.length} textes libres dans le bloc de titre : « ${nomBrut} » retenu comme nom, ` +
        `« ${categorie} » comme catégorie, ignoré(s) : ${entete.slice(0, -2).map((t) => `« ${t} »`).join(", ")}. ` +
        "À vérifier — une ligne de note insérée sous le titre serait prise pour le nom.",
    });
  }

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
      textesEntete: entete,
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
  const prixInvraisemblables = detecterPrixInvraisemblables(articles);

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
    prixInvraisemblables,
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

export type SimulationFiche = {
  nom: string;
  incomplet: boolean;
  motifs: string[];
  coutParPortion: string | null;
  /** Coût total HT de la fiche entière, pleine précision (`null` si indéterminé). */
  coutTotal: Decimal | null;
  nbPortions: number;
};

/**
 * Passe le résultat du parsing dans le VRAI moteur (`calculerCout`) pour chiffrer, avant tout
 * import, combien de fiches sortiront en coût incomplet et pourquoi. Le moteur n'est pas modifié.
 *
 * `arrondiSchema = true` rejoue le même calcul avec les valeurs TELLES QU'ELLES SERONT ÉCRITES
 * (prix à 4 décimales, quantités à 3). Comparer les deux passes donne l'effet réel des arrondis
 * de schéma EN DOLLARS — la seule unité dans laquelle la Direction peut trancher.
 */
export function simulerCouts(res: ResultatParse, options: { arrondiSchema?: boolean } = {}): SimulationFiche[] {
  const fichesCalc = new Map<string, FicheCalc>();
  const idDe = (f: FicheParsee) => f.onglet;
  const q = (v: number) => (options.arrondiSchema ? arrondir(v, DECIMALES_QUANTITE).toString() : v);
  const p = (v: number | null) => (v === null ? null : options.arrondiSchema ? arrondir(v, DECIMALES_PRIX).toString() : v);

  for (const f of res.fiches) {
    const ingredients: IngredientCalc[] = res.lignes
      .filter((l) => l.fiche === f)
      .map((l) => {
        const base = { nom: l.ingredient.designation, unite: l.ingredient.unite, quantite: q(l.ingredient.quantite ?? 0) };
        if (l.rattachement.type === "ARTICLE") {
          return {
            ...base,
            article: {
              prixUnitaireUSD: p(l.rattachement.article.prixUnitaireUSD),
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
    const indetermine = r.incomplet && r.coutParPortion.isZero();
    return {
      nom: f.nom,
      incomplet: r.incomplet,
      motifs: r.ingredientsSansPrix,
      coutParPortion: indetermine ? null : r.coutParPortion.toDecimalPlaces(4).toString(),
      coutTotal: indetermine ? null : r.coutTotal,
      nbPortions: f.nbPortions ?? 1,
    };
  });
}

// ─── Rapport ─────────────────────────────────────────────────────────────────

export function formaterRapport(
  res: ResultatParse,
  simulation: SimulationFiche[],
  simulationArrondie: SimulationFiche[],
): string {
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
  out.push("  /!\\ CE CONTRÔLE N'EST PAS EXHAUSTIF : il compare deux colonnes de prix entre elles et ne");
  out.push("  voit donc RIEN quand une seule est en cause (prix saisi dans une autre unité que celle");
  out.push("  déclarée), ni quand la quantité par paquet contient du texte. Cette famille-là est");
  out.push("  couverte par le contrôle de vraisemblance ci-dessous, à lire avec celui-ci.");

  out.push(bloc("PRIX INVRAISEMBLABLES À L'UNITÉ (ce que le contrôle précédent ne peut PAS voir)"));
  out.push(`  Méthode : prix ramené au kg (ou au litre) et comparé à la MÉDIANE des articles de la même`);
  out.push(`  grandeur. Au-delà d'un rapport de ${SEUIL_INVRAISEMBLANCE}, ce n'est plus une variation de marché.`);
  out.push("  Les unités de comptage (pièce, boîte, bouteille…) sont hors comparaison : deux « pièces »");
  out.push("  ne sont pas commensurables, on ne prétend pas le contraire.");
  if (res.prixInvraisemblables.length === 0) out.push("  Aucun prix aberrant détecté.");
  for (const p of res.prixInvraisemblables) {
    const cle = normaliserDesignation(p.designation);
    const fichesTouchees = [...new Set(
      res.lignes.filter((l) => l.rattachement.type === "ARTICLE" && l.rattachement.article.cle === cle).map((l) => l.fiche.nom)
    )];
    const sens = p.rapport < 1 ? `${Math.round(1 / p.rapport)} fois TROP BAS` : `${Math.round(p.rapport)} fois trop haut`;
    out.push(`  • L${p.ligne} ${p.designation} — ${p.prixUnitaire} $ / « ${p.unite} »`);
    out.push(`      soit ${p.prixRamene} $/${p.grandeur} contre une médiane de ${p.mediane} $/${p.grandeur} : ${sens}.`);
    if (fichesTouchees.length > 0) {
      out.push(`      Coût sous-évalué dans ${fichesTouchees.length} fiche(s) : ${fichesTouchees.join(", ")}`);
    } else {
      out.push("      Aucune fiche ne l'utilise pour l'instant.");
    }
  }
  out.push("  SIGNALÉ, NON CORRIGÉ : la médiane est un indice, pas une vérité. La Direction tranche.");

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

  out.push(bloc("QUANTITÉS ABSENTES DU CLASSEUR (fiches qui NE PEUVENT PAS être chiffrées)"));
  if (res.quantitesAbsentes.length === 0) out.push("  Aucune.");
  for (const l of res.quantitesAbsentes) {
    const article = l.rattachement.type === "ARTICLE" ? l.rattachement.article : null;
    out.push(`  • FICHE « ${l.fiche.nom} » (L${l.ingredient.ligne}) : « ${l.ingredient.designation} » — colonne « Unités nécessaires » vide`);
    if (article?.prixUnitaireUSD) {
      out.push(`      L'article vaut ${article.prixUnitaireUSD} $ / « ${article.unite} » : chaque unité oubliée coûte ce montant à la fiche.`);
    }
  }
  if (res.quantitesAbsentes.length > 0) {
    out.push("  Importées à 0 — le schéma n'accepte pas d'inconnue — mais le moteur lève désormais");
    out.push("  « QUANTITE_ABSENTE » sur toute quantité à 0 : la fiche sort en COÛT INCOMPLET et");
    out.push("  n'est jamais présentée comme chiffrée. C'est la correction du piège suivant : comptée");
    out.push("  0, la ligne se faisait passer pour une quantité connue et la fiche pour complète.");
    out.push("  Ces fiches restent donc À CHIFFRER tant que la Direction n'a pas donné la quantité.");
  }

  out.push(bloc("ARRONDIS IMPOSÉS PAR LE SCHÉMA — EFFET RÉEL, EN DOLLARS"));
  out.push("  Les colonnes de la base ont une précision finie (prix 4 décimales, quantités 3). La");
  out.push("  question n'est pas « de combien de % une valeur bouge » — un % sur un prix au gramme ne");
  out.push("  veut rien dire — mais « de combien de dollars le coût d'une fiche bouge ». Réponse :");
  const ecartsFiches = simulation
    .map((brut) => {
      const arr = simulationArrondie.find((s) => s.nom === brut.nom);
      if (!arr || brut.coutTotal === null || arr.coutTotal === null) return null;
      const ecart = arr.coutTotal.minus(brut.coutTotal);
      return { nom: brut.nom, ecart, parPortion: ecart.div(brut.nbPortions || 1) };
    })
    .filter((x): x is { nom: string; ecart: Decimal; parPortion: Decimal } => x !== null)
    .sort((a, b) => b.ecart.abs().comparedTo(a.ecart.abs()));
  const nuls = ecartsFiches.filter((e) => e.ecart.isZero());
  const visibles = ecartsFiches.filter((e) => e.ecart.abs().greaterThanOrEqualTo("0.0001"));
  const negligeables = ecartsFiches.length - nuls.length - visibles.length;
  const pire = visibles[0];
  out.push(`  • Fiches dont le coût est déterminable et donc comparable : ${ecartsFiches.length} sur ${simulation.length}`);
  out.push(`    (les ${simulation.length - ecartsFiches.length} autres sont à coût indéterminé, cf. section « SIMULATION »).`);
  out.push(`  • Écart EXACTEMENT NUL ................ ${nuls.length} fiche(s)`);
  out.push(`  • Écart sous le dixième de centime .... ${negligeables} fiche(s)`);
  out.push(`  • Écart visible au dixième de centime . ${visibles.length} fiche(s), détaillées ci-dessous`);
  if (pire) {
    out.push(`  • PIRE ÉCART : ${pire.nom} — ${pire.ecart.toDecimalPlaces(4).toString()} $ sur la fiche entière,`);
    out.push(`    soit ${pire.parPortion.toDecimalPlaces(4).toString()} $ par portion. Un centime et demi sur une fiche ENTIÈRE.`);
  }
  for (const e of visibles) {
    out.push(`      ${e.nom.padEnd(52)} ${e.ecart.toDecimalPlaces(4).toString().padStart(9)} $   (${e.parPortion.toDecimalPlaces(4).toString()} $/portion)`);
  }
  out.push("  CONCLUSION : aucune migration n'est justifiée. À titre de comparaison, l'écart entre le");
  out.push("  classeur et le moteur (arrondis intermédiaires du classeur) vaut 0,01 $ sur la seule");
  out.push("  Bolognaise — soit davantage que le pire arrondi de schéma ci-dessus.");
  out.push(`  (${res.arrondis.length} valeur(s) individuelle(s) sont effectivement arrondies à l'écriture ; c'est leur`);
  out.push("  effet cumulé, chiffré ci-dessus, qui décide — pas le pourcentage de chacune.)");

  out.push(bloc("INTERPRÉTATION DU BLOC DE TITRE (nom / catégorie retenus, à relire)"));
  out.push("  Le nom est le DERNIER texte libre avant « Nombre de portions : », la catégorie celui");
  out.push("  d'avant. Règle exacte sur ce classeur, mais une note insérée sous le titre deviendrait");
  out.push("  le nom : les 3+ textes lèvent une anomalie, et le tableau ci-dessous se relit à l'œil.");
  out.push(`  ${"Onglet".padEnd(32)} ${"Nom retenu".padEnd(46)} Catégorie`);
  for (const f of res.fiches) {
    const divergent = normaliserDesignation(f.nom) !== normaliserDesignation(f.onglet) ? " ≠" : "  ";
    out.push(`  ${(f.onglet + divergent).padEnd(32)} ${f.nom.padEnd(46)} ${f.categorie ?? "—"}`);
  }
  out.push("  « ≠ » = le nom retenu diffère du nom d'onglet. Normal quand l'onglet est abrégé");
  out.push("  (« Filet de saumon » / « Filet de saumon au beurre blanc aux câpres ») — c'est B13 qui");
  out.push("  fait foi, l'onglet est tronqué par Excel. À relire tout de même.");

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

/**
 * Client Prisma minimal dont l'écriture a besoin. Déclaré structurellement plutôt qu'importé :
 * le parseur et le rapport restent utilisables sans `@prisma/client`, et le test d'intégration
 * injecte son propre client branché sur un Postgres jetable.
 */
export type ClientEcriture = {
  ficheTechnique: {
    findMany(args: unknown): Promise<FicheEnBase[]>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  ingredientFiche: { findMany(args: unknown): Promise<{ ficheId: string; sousFicheId: string | null }[]> };
  articleStock: { findMany(args: unknown): Promise<ArticleEnBase[]> };
  $transaction<T>(fn: (tx: TxEcriture) => Promise<T>, options?: unknown): Promise<T>;
};

type TxEcriture = {
  articleStock: {
    update(args: unknown): Promise<unknown>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  ficheTechnique: { create(args: { data: Record<string, unknown>; select: unknown }): Promise<{ id: string }> };
  ingredientFiche: { createMany(args: { data: unknown[] }): Promise<unknown> };
};

type Dec = { toString(): string };

type FicheEnBase = {
  id: string;
  nom: string;
  categorie: string | null;
  nbPortions: number;
  tauxTVA: Dec;
  prixVenteTTC: Dec | null;
  coefficientMargeCible: Dec | null;
  estSousRecette: boolean;
  rendementQuantite: Dec | null;
  rendementUnite: string | null;
  recette: string | null;
  ingredients: {
    unite: string;
    quantite: Dec;
    ordre: number;
    article: { designation: string } | null;
    sousFiche: { nom: string } | null;
  }[];
};

type ArticleEnBase = {
  id: string;
  designation: string;
  domaine: string;
  unite: string | null;
  uniteParCarton: Dec | null;
  prixUnitaireUSD: Dec | null;
  prixCartonUSD: Dec | null;
};

/** Sélection Prisma correspondant exactement à `FicheEnBase` (empreinte de contenu). */
export const SELECT_FICHE_SIGNATURE = {
  id: true, nom: true, categorie: true, nbPortions: true, tauxTVA: true, prixVenteTTC: true,
  coefficientMargeCible: true, estSousRecette: true, rendementQuantite: true, rendementUnite: true,
  recette: true,
  ingredients: {
    orderBy: { ordre: "asc" },
    select: {
      unite: true, quantite: true, ordre: true,
      article: { select: { designation: true } },
      sousFiche: { select: { nom: true } },
    },
  },
} as const;

const texteDec = (v: Dec | null | undefined): string =>
  v === null || v === undefined ? "—" : new Decimal(v.toString()).toString();

/**
 * Empreinte du contenu d'une fiche. Deux empreintes identiques ⇒ supprimer puis recréer la fiche
 * est STRICTEMENT NEUTRE. C'est ce qui autorise `--force` à supprimer sans rien détruire : dès
 * qu'une valeur diffère (un prix retouché, une ligne ajoutée), l'empreinte change et la fiche est
 * protégée. Indispensable, car `FicheTechnique.nom` n'a AUCUNE contrainte d'unicité et les noms du
 * classeur sont des noms de carte ordinaires (Carbonara, Bolognaise, Crème brûlée…) qu'un cuisinier
 * ressaisira spontanément.
 */
function empreinteBase(f: FicheEnBase): string {
  const lignes = f.ingredients.map((i, index) => [
    normaliserDesignation(i.article?.designation ?? i.sousFiche?.nom ?? "?"),
    normaliserUnite(i.unite),
    texteDec(i.quantite),
    index,
  ].join("~"));
  return [
    f.nom.trim(), f.categorie?.trim() ?? "—", f.nbPortions, texteDec(f.tauxTVA), texteDec(f.prixVenteTTC),
    texteDec(f.coefficientMargeCible), f.estSousRecette, texteDec(f.rendementQuantite), f.rendementUnite ?? "—",
    f.recette ?? "—", ...lignes,
  ].join("|");
}

/** La même empreinte, calculée sur ce que l'import ÉCRIRAIT (mêmes arrondis, même ordre). */
function empreinteClasseur(f: FicheParsee, res: ResultatParse): string {
  const lignes = res.lignes
    .filter((l) => l.fiche === f && l.rattachement.type !== "AUCUN")
    .map((l, index) => [
      normaliserDesignation(
        l.rattachement.type === "ARTICLE" ? l.rattachement.article.designation
          : l.rattachement.type === "SOUS_RECETTE" ? l.rattachement.fiche.nom : "?"
      ),
      normaliserUnite(l.ingredient.unite),
      arrondir(l.ingredient.quantite ?? 0, DECIMALES_QUANTITE).toString(),
      index,
    ].join("~"));
  return [
    f.nom.trim(), f.categorie?.trim() ?? "—",
    f.nbPortions !== null && f.nbPortions > 0 ? Math.round(f.nbPortions) : 1,
    f.tauxTVA === null ? "0.16" : arrondir(f.tauxTVA, 4).toString(),
    f.prixVenteTTC === null ? "—" : arrondir(f.prixVenteTTC, DECIMALES_PRIX).toString(),
    f.coefficientMargeCible === null ? "—" : arrondir(f.coefficientMargeCible, 4).toString(),
    f.estSousRecette,
    f.rendementQuantiteG === null ? "—" : arrondir(f.rendementQuantiteG, 3).toString(),
    f.rendementQuantiteG === null ? "—" : "g",
    f.recette ?? "—", ...lignes,
  ].join("|");
}

export type OptionsEcriture = {
  force: boolean;
  /** Noms de fiches divergentes dont la suppression est autorisée NOMMÉMENT (`--supprimer`). */
  supprimerNommement?: string[];
  /** Ne réécrit pas les prix d'un article déjà en base (préserve les corrections de la Direction). */
  conserverPrixExistants?: boolean;
};

export type EcrasementPrix = {
  designation: string;
  champ: "prix à l'unité" | "prix carton" | "unité" | "quantité par paquet";
  avant: string;
  apres: string;
};

export type RapportEcriture = {
  statut: "IMPORTE" | "DEJA_FAIT" | "ABANDON";
  message: string;
  fichesSupprimees: string[];
  /** Fiches homonymes divergentes : elles ont bloqué l'import, ou attendent `--supprimer`. */
  fichesProtegees: string[];
  articlesCrees: number;
  articlesMisAJour: number;
  fichesCreees: number;
  ingredientsCrees: number;
  ecrasementsPrix: EcrasementPrix[];
};

/**
 * Écrit le classeur en base. `prisma` est INJECTÉ : `main()` lui passe un client branché sur l'URL
 * fournie explicitement, le test d'intégration un client branché sur un Postgres jetable.
 * Aucune écriture n'a lieu quand le statut renvoyé est « DEJA_FAIT » ou « ABANDON ».
 */
export async function ecrireEnBase(
  prisma: ClientEcriture,
  res: ResultatParse,
  options: OptionsEcriture,
): Promise<RapportEcriture> {
  const vide = {
    fichesSupprimees: [] as string[], fichesProtegees: [] as string[],
    articlesCrees: 0, articlesMisAJour: 0, fichesCreees: 0, ingredientsCrees: 0,
    ecrasementsPrix: [] as EcrasementPrix[],
  };
  const autorisees = new Set((options.supprimerNommement ?? []).map((n) => n.trim()));

  // ── Idempotence. Le marqueur est la clé naturelle (les noms du classeur), MAIS « une fiche
  //    homonyme existe » ne veut pas dire « import déjà fait » : il faut qu'elles y soient TOUTES
  //    et qu'elles soient toutes conformes. Sinon une seule « Carbonara » saisie à la main ferait
  //    afficher « déjà importé » et n'importerait rien du tout — ni fiche, ni article — en silence.
  const parNom = new Map(res.fiches.map((f) => [f.nom, f]));
  const existantes = await prisma.ficheTechnique.findMany({
    where: { nom: { in: [...parNom.keys()] } },
    select: SELECT_FICHE_SIGNATURE,
  });

  const conformes: FicheEnBase[] = [];
  const divergentes: FicheEnBase[] = [];
  for (const e of existantes) {
    const duClasseur = parNom.get(e.nom);
    (duClasseur && empreinteBase(e) === empreinteClasseur(duClasseur, res) ? conformes : divergentes).push(e);
  }
  const toutesLa = conformes.length === parNom.size && divergentes.length === 0;

  if (!options.force) {
    if (toutesLa) {
      return {
        ...vide,
        statut: "DEJA_FAIT",
        message: `Import déjà effectué : les ${conformes.length} fiches du classeur sont en base, à l'identique. Rien à faire.`,
      };
    }
    if (existantes.length > 0) {
      return {
        ...vide,
        statut: "ABANDON",
        fichesProtegees: divergentes.map((f) => f.nom),
        message:
          `ABANDON : ${existantes.length} fiche(s) sur ${parNom.size} portent déjà un nom du classeur, ` +
          `dont ${divergentes.length} dont le CONTENU DIFFÈRE` +
          (divergentes.length > 0 ? ` (${divergentes.map((f) => `« ${f.nom} »`).join(", ")})` : "") +
          ". Rien n'a été écrit — ni fiche, ni article. Ces fiches ont pu être saisies à la main : " +
          "`FicheTechnique.nom` n'est pas unique, et « Carbonara » ou « Bolognaise » sont des noms de " +
          "carte ordinaires. Relance avec --force pour remplacer les fiches CONFORMES, et " +
          '--supprimer "<nom>" pour autoriser nommément la destruction de chaque fiche divergente.',
      };
    }
  }

  const aSupprimer = [...conformes, ...divergentes.filter((f) => autorisees.has(f.nom))];
  const refusees = divergentes.filter((f) => !autorisees.has(f.nom));
  if (options.force && refusees.length > 0) {
    return {
      ...vide,
      statut: "ABANDON",
      fichesProtegees: refusees.map((f) => f.nom),
      message:
        `ABANDON : ${refusees.length} fiche(s) portent un nom du classeur mais un contenu DIFFÉRENT. ` +
        "--force ne les détruit pas de lui-même : elles ont pu être saisies ou corrigées à la main. " +
        "Ce qui serait détruit : " +
        refusees.map((f) => `« ${f.nom} » (${f.ingredients.length} ingrédient(s))`).join(", ") +
        ". Pour l'autoriser, ajoute : " + refusees.map((f) => `--supprimer "${f.nom}"`).join(" ") +
        ". Rien n'a été écrit.",
    };
  }

  const rapport: RapportEcriture = { ...vide, statut: "IMPORTE", message: "" };

  // ── Suppression en ORDRE DE DÉPENDANCE. `IngredientFiche.sousFicheId` est en `onDelete:
  //    Restrict`, non déférable en PostgreSQL : supprimer une sous-recette encore citée échoue
  //    immédiatement. On retire donc par vagues ce que plus personne ne cite (les plats d'abord,
  //    les sous-recettes ensuite), quelle que soit la profondeur d'imbrication.
  if (aSupprimer.length > 0) {
    let restants = aSupprimer.map((f) => ({ id: f.id, nom: f.nom }));
    const idsLot = new Set(restants.map((f) => f.id));
    while (restants.length > 0) {
      const citations = await prisma.ingredientFiche.findMany({
        where: { sousFicheId: { in: restants.map((f) => f.id) } },
        select: { ficheId: true, sousFicheId: true },
      });
      const citees = new Set(citations.map((c) => c.sousFicheId));
      const supprimables = restants.filter((f) => !citees.has(f.id));

      if (supprimables.length === 0) {
        // Reste une citation venant d'une fiche HORS lot : on ne casse pas une fiche qu'on n'a
        // pas le droit de toucher pour faire de la place.
        const bloqueurs = citations.filter((c) => !idsLot.has(c.ficheId));
        return {
          ...vide,
          statut: "ABANDON",
          fichesProtegees: restants.map((f) => f.nom),
          message:
            `ABANDON : ${restants.length} sous-recette(s) (${restants.map((f) => `« ${f.nom} »`).join(", ")}) sont ` +
            `encore citées comme ingrédient par ${bloqueurs.length} ligne(s) de fiches HORS classeur. Les supprimer ` +
            "violerait `IngredientFiche.sousFicheId` (onDelete: Restrict). Rien de plus n'a été écrit — " +
            "détache ces lignes, ou autorise la suppression des fiches qui les portent.",
        };
      }
      await prisma.ficheTechnique.deleteMany({ where: { id: { in: supprimables.map((f) => f.id) } } });
      rapport.fichesSupprimees.push(...supprimables.map((f) => f.nom));
      const supprimes = new Set(supprimables.map((f) => f.id));
      restants = restants.filter((f) => !supprimes.has(f.id));
    }
  }

  // ── 1. Articles : upsert par désignation normalisée.
  const existants = await prisma.articleStock.findMany({
    select: {
      id: true, designation: true, domaine: true, unite: true,
      uniteParCarton: true, prixUnitaireUSD: true, prixCartonUSD: true,
    },
  });
  const parCleBase = new Map<string, ArticleEnBase>();
  for (const a of existants) {
    const cle = normaliserDesignation(a.designation);
    if (!parCleBase.has(cle)) parCleBase.set(cle, a);
  }
  const idParCle = new Map([...parCleBase].map(([cle, a]) => [cle, a.id]));

  await prisma.$transaction(async (tx) => {
    for (const a of res.articles) {
      const nouveau = {
        unite: a.unite,
        uniteParCarton: a.uniteParCarton === null ? null : arrondir(a.uniteParCarton, 2).toString(),
        prixUnitaireUSD: a.prixUnitaireUSD === null ? null : arrondir(a.prixUnitaireUSD, DECIMALES_PRIX).toString(),
        prixCartonUSD: a.prixCartonUSD === null ? null : arrondir(a.prixCartonUSD, DECIMALES_PRIX).toString(),
      };
      const ancien = parCleBase.get(a.cle);

      if (!ancien) {
        // `domaine` n'est posé qu'à la création : un article déjà classé BOISSON ne doit pas
        // devenir NOURRITURE parce qu'il figure aussi dans ce classeur.
        const cree = await tx.articleStock.create({ data: { designation: a.designation, domaine: "NOURRITURE", ...nouveau } });
        idParCle.set(a.cle, cree.id);
        rapport.articlesCrees++;
        continue;
      }

      // Le classeur écrase le catalogue : si la Direction a corrigé un prix DANS L'APPLICATION,
      // le réimporter le remet à la valeur (fausse) du classeur. Tout ce qui bouge est listé.
      const compare: [EcrasementPrix["champ"], string, string][] = [
        ["prix à l'unité", texteDec(ancien.prixUnitaireUSD), nouveau.prixUnitaireUSD ?? "—"],
        ["prix carton", texteDec(ancien.prixCartonUSD), nouveau.prixCartonUSD ?? "—"],
        ["unité", ancien.unite ?? "—", nouveau.unite ?? "—"],
        ["quantité par paquet", texteDec(ancien.uniteParCarton), nouveau.uniteParCarton ?? "—"],
      ];
      for (const [champ, avant, apres] of compare) {
        const prixConserve = options.conserverPrixExistants && (champ === "prix à l'unité" || champ === "prix carton");
        if (avant !== apres && !prixConserve) {
          rapport.ecrasementsPrix.push({ designation: a.designation, champ, avant, apres });
        }
      }

      const donnees = options.conserverPrixExistants
        ? { unite: nouveau.unite, uniteParCarton: nouveau.uniteParCarton } // prix laissés intacts
        : nouveau;
      await tx.articleStock.update({ where: { id: ancien.id }, data: donnees });
      rapport.articlesMisAJour++;
    }
  }, { timeout: 120_000 });

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
    rapport.fichesCreees = ordreCreation.length;

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
    rapport.ingredientsCrees = aInserer.length;
  }, { timeout: 120_000 });

  rapport.message =
    `Import terminé : ${rapport.articlesCrees} article(s) créé(s), ${rapport.articlesMisAJour} mis à jour, ` +
    `${rapport.fichesCreees} fiche(s) et ${rapport.ingredientsCrees} ingrédient(s) créés` +
    (rapport.fichesSupprimees.length > 0 ? `, ${rapport.fichesSupprimees.length} fiche(s) remplacée(s)` : "") + ".";
  return rapport;
}

// ─── Exécution ───────────────────────────────────────────────────────────────

/** Valeurs de `--supprimer "<nom>"` (répétable), séparées de l'URL et du chemin de fichier. */
function lireSupprimer(args: string[]): string[] {
  const noms: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--supprimer" && args[i + 1] !== undefined) noms.push(args[++i]!);
    else if (args[i]!.startsWith("--supprimer=")) noms.push(args[i]!.slice("--supprimer=".length));
  }
  return noms;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const conserverPrixExistants = args.includes("--conserver-prix-existants");
  const supprimerNommement = lireSupprimer(args);

  // Une URL de base commence par « postgres… » : tout autre positionnel est un chemin de fichier.
  // Ainsi `--dry-run "/chemin/classeur.xlsx"` fonctionne sans jamais mentionner de base.
  const valeursDOptions = new Set(supprimerNommement);
  const positionnels = args.filter((a) => !a.startsWith("--") && !valeursDOptions.has(a));
  const urls = positionnels.filter((p) => /^postgres(ql)?:\/\//i.test(p));
  const chemins = positionnels.filter((p) => !/^postgres(ql)?:\/\//i.test(p));
  const databaseUrl = urls[0] ?? process.env.IMPORT_DATABASE_URL;
  const cheminFichier = chemins[0] ?? CHEMIN_PAR_DEFAUT;

  console.log(`Fichier source : ${cheminFichier}`);
  console.log(`Mode : ${dryRun ? "MARCHE À VIDE (aucune écriture, aucune connexion)" : "IMPORT"}`);

  const wb = XLSX.readFile(cheminFichier, { cellFormula: false, cellHTML: false, cellStyles: false, bookDeps: false });
  const res = analyserClasseur(wb);
  console.log(formaterRapport(res, simulerCouts(res), simulerCouts(res, { arrondiSchema: true })));

  if (dryRun) return;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL manquante : passe-la en 1er argument (npx tsx scripts/import-fiches-plats.ts "postgresql://...") ' +
        "ou via IMPORT_DATABASE_URL, ou lance --dry-run. Aucun défaut vers la prod n'est fourni volontairement " +
        "(le .env du dépôt pointe la PRODUCTION)."
    );
  }
  console.log(`\nBase cible : ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`); // mot de passe masqué

  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const r = await ecrireEnBase(prisma as unknown as ClientEcriture, res, { force, supprimerNommement, conserverPrixExistants });
    console.log(`\n${r.statut} — ${r.message}`);
    if (r.fichesSupprimees.length > 0) {
      console.log(`Fiches remplacées (contenu identique au classeur, suppression neutre) : ${r.fichesSupprimees.join(", ")}`);
    }
    if (r.ecrasementsPrix.length > 0) {
      console.log(
        `\n/!\\ ${r.ecrasementsPrix.length} valeur(s) d'article ÉCRASÉE(S) par le classeur. Si la Direction a corrigé ` +
          "un prix dans l'application, il vient d'être ramené à la valeur du classeur.\n" +
          "    Relance avec --conserver-prix-existants pour préserver les prix déjà en base."
      );
      for (const e of r.ecrasementsPrix) console.log(`    - ${e.designation} — ${e.champ} : ${e.avant} → ${e.apres}`);
    }
    if (res.nonRattaches.length > 0) {
      console.log(`\n/!\\ ${res.nonRattaches.length} ingrédient(s) NON créé(s) faute de rattachement sûr (cf. §3 du rapport).`);
    }
    if (r.statut === "ABANDON") process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Exécution directe uniquement (jamais lors d'un import par les tests du parseur).
if (process.argv[1] && process.argv[1].endsWith("import-fiches-plats.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
