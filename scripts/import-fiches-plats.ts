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
 * ─── MODE `--fiches-seules` (ADDITION, le mode ci-dessus est inchangé) ───────────────────────
 *
 * « On veut les fiches, on ne touche pas au catalogue » (décision de la Direction, août 2026 :
 * l'import complet effacerait 5 prix, en triplerait un, et créerait 63 articles dont 49 sont des
 * quasi-doublons d'articles existants nommés autrement). Ce mode :
 *
 *   - N'ÉCRIT RIEN DANS `ArticleStock` — ni création, ni mise à jour, ni upsert. Garanti PAR
 *     CONSTRUCTION et non par un `if` : l'écriture passe par `ecrireFichesSeules`, dont le client
 *     (`ClientFichesSeules`) n'expose que `articleStock.findMany` (lecture), et dont la
 *     transaction (`TxFichesSeules`) N'A PAS DE `articleStock` DU TOUT. Aucun chemin de code de ce
 *     mode ne mentionne `articleStock.create` ni `articleStock.update`, et son rapport
 *     (`RapportFichesSeules`) n'a même pas de champ où compter un article écrit.
 *   - rattache chaque ingrédient à un `ArticleStock` DÉJÀ PRÉSENT dans la base cible, par
 *     `normaliserDesignation` — jamais « au plus proche », jamais deviné ;
 *   - RÈGLE CARDINALE : une fiche dont AU MOINS UN ingrédient ne se rattache pas n'est PAS créée
 *     du tout. Motif : `IngredientFiche` n'a aucun champ de libellé (cf. prisma/schema.prisma) —
 *     une ligne sans article ni sous-fiche serait MUETTE à l'écran, et la fiche afficherait un
 *     coût trop bas avec l'apparence d'un coût complet. Mieux vaut pas de fiche qu'une fiche
 *     mensongère. Les fiches refusées sont nommées dans le rapport, avec les articles introuvables ;
 *   - les sous-recettes sont créées normalement (elles ne dépendent pas du catalogue pour
 *     exister), mais la même règle s'applique : une sous-recette refusée fait refuser, en cascade,
 *     toute fiche qui la cite ;
 *   - ordre de création inchangé (sous-recettes puis plats), idempotence inchangée (`--force`
 *     reste protégé par l'empreinte de contenu, qui refuse de détruire une fiche saisie à la main).
 *
 * `--fiches-seules --dry-run` est une SIMULATION QUI SE CONNECTE : contrairement au `--dry-run`
 * ordinaire (qui n'ouvre aucune connexion et ne peut donc rien dire d'un vrai catalogue), elle lit
 * le catalogue réel sous une protection de lecture seule VÉRIFIÉE, à deux niveaux :
 *
 *   NIVEAU 1 — transaction interactive `SET TRANSACTION READ ONLY`, vérifiée par
 *     `SHOW transaction_read_only` avant ET après les lectures, terminée par un ROLLBACK.
 *     Délais généreux (`maxWait` 30 s, `timeout` 120 s), surchargeables par
 *     `IMPORT_TX_MAX_WAIT_MS` / `IMPORT_TX_TIMEOUT_MS`.
 *   NIVEAU 2 — repli si le pooler n'accorde PAS de transaction interactive (Supabase Supavisor :
 *     `P2028 Unable to start a transaction in the given time`) : une SESSION DÉDIÉE — une seule
 *     connexion physique — placée en `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`,
 *     vérifiée elle aussi par `SHOW transaction_read_only` AVANT la moindre lecture.
 *     Piège du pooler traité de front : en mode transaction, deux requêtes successives peuvent
 *     atterrir sur deux sessions serveur différentes — le `SET` s'appliquerait alors à l'une et
 *     les lectures à l'autre, et la vérification ne prouverait RIEN. `pg_backend_pid()` est donc
 *     relevé avant le `SET`, après la vérification et après les lectures : au moindre changement,
 *     la simulation REFUSE. Jamais de dégradation silencieuse.
 *
 * Un drapeau qui répond autre chose que « on » est un REFUS de la base, pas une indisponibilité :
 * il n'ouvre aucun repli, il arrête tout. Et quelle que soit la protection obtenue, la garantie de
 * FOND reste le verrou de TYPE (`ClientFichesSeules` ne déclare que `findMany`) : la lecture seule
 * côté base n'en est que la ceinture. La sortie dit laquelle des deux protections est active.
 *
 * Elle rapporte : fiches créables / refusées, articles
 * introuvables dédoublonnés du plus utilisé au moins utilisé (la liste de travail à remettre à la
 * Direction), le SOSIE le plus proche de chacun (SUGGESTION à vérifier, jamais une décision :
 * « Huile 1L régina » et « Huile 5L régina » sont des CONDITIONNEMENTS DIFFÉRENTS), et le coût
 * complet / partiel des fiches créables via le vrai moteur (`calculerCout`, non modifié).
 *
 * Usage :
 *   npx tsx scripts/import-fiches-plats.ts --dry-run                  (rapport seul, AUCUNE base)
 *   npx tsx scripts/import-fiches-plats.ts "postgresql://..." ["/chemin/classeur.xlsx"]
 *        [--force] [--supprimer "<nom de fiche>"]… [--conserver-prix-existants]
 *   npx tsx scripts/import-fiches-plats.ts "postgresql://..." --fiches-seules --dry-run
 *        (simulation EN LECTURE SEULE sur la base cible : aucune écriture, transaction READ ONLY)
 *   npx tsx scripts/import-fiches-plats.ts "postgresql://..." --fiches-seules [--force]
 *        [--supprimer "<nom de fiche>"]…   (crée les fiches, NE TOUCHE PAS au catalogue)
 *   (ou IMPORT_DATABASE_URL=postgresql://... npx tsx scripts/import-fiches-plats.ts)
 *
 * JAMAIS de défaut vers la prod : hors `--dry-run` ordinaire, la DATABASE_URL doit être fournie
 * explicitement (argument positionnel ou IMPORT_DATABASE_URL) — y compris pour
 * `--fiches-seules --dry-run`, qui se connecte réellement. Le `.env` du dépôt pointe la
 * PRODUCTION et n'est volontairement pas lu ici.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/**
 * Formate un prix flottant pour un rapport LU PAR UN HUMAIN, sans les artefacts de virgule
 * flottante JS (0.35 × 12 / 500 = « 0.0014199999999999998 » alors que la valeur voulue est
 * 0,00142). Purement cosmétique : n'arrondit rien qui parte en base (`arrondir` fait ça, à
 * DECIMALES_PRIX) ; ici on garde 6 décimales pour ne pas écraser un prix réellement au gramme.
 */
function formatPrixRapport(v: number): string {
  return new Decimal(v).toDecimalPlaces(6).toString();
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
    out.push(`  • L${p.ligne} ${p.designation} — ${formatPrixRapport(p.prixUnitaire)} $ / « ${p.unite} »`);
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
  // « Comparable » (ce bloc) et « complet » (bloc SIMULATION) mesurent deux choses différentes.
  // Écrire « déterminable » ici laissait lire une contradiction avec « 11 fiches à coût incomplet »
  // deux blocs plus loin. Le lien est donc dit explicitement, chiffres à l'appui.
  const nomsComparables = new Set(ecartsFiches.map((e) => e.nom));
  const incompletesComparables = simulation.filter((s) => s.incomplet && nomsComparables.has(s.nom)).length;
  out.push(`  • Fiches COMPARABLES d'une passe à l'autre : ${ecartsFiches.length} sur ${simulation.length}`);
  out.push(`    (les ${simulation.length - ecartsFiches.length} autres ne portent aucun montant, même partiel : rien à comparer).`);
  out.push(`    « Comparable » ne veut PAS dire « complet » : une fiche à coût partiel porte bien un`);
  out.push("    montant chiffré (un minorant), donc un écart d'arrondi mesurable. C'est pourquoi");
  out.push(`    ${incompletesComparables} des fiches comptées ici sont aussi comptées « à coût incomplet » dans la section`);
  out.push("    « SIMULATION » plus bas : les deux nombres se complètent, ils ne se contredisent pas.");
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
  type: string;
  nbPortions: number;
  tauxTVA: Dec;
  prixVenteTTC: Dec | null;
  coefficientMargeCible: Dec | null;
  estSousRecette: boolean;
  rendementQuantite: Dec | null;
  rendementUnite: string | null;
  recette: string | null;
  actif: boolean;
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
  id: true, nom: true, categorie: true, type: true, nbPortions: true, tauxTVA: true, prixVenteTTC: true,
  coefficientMargeCible: true, estSousRecette: true, rendementQuantite: true, rendementUnite: true,
  recette: true, actif: true,
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
    f.nom.trim(), f.categorie?.trim() ?? "—", f.type, f.nbPortions, texteDec(f.tauxTVA), texteDec(f.prixVenteTTC),
    texteDec(f.coefficientMargeCible), f.estSousRecette, texteDec(f.rendementQuantite), f.rendementUnite ?? "—",
    f.recette ?? "—", f.actif, ...lignes,
  ].join("|");
}

/** Une ligne d'ingrédient réduite à ce qui entre dans l'empreinte (quel que soit le mode). */
type LigneEmpreinte = { designation: string; unite: string; quantite: number | null };

/**
 * Cœur commun de l'empreinte « côté classeur », partagé par l'import complet et le mode
 * `--fiches-seules` : les deux modes écrivent EXACTEMENT les mêmes colonnes de fiche, seule la
 * liste des lignes retenues diffère (le mode fiches seules ne crée que des fiches dont TOUTES les
 * lignes se rattachent). Un seul endroit où raisonner sur `type`, `actif` et les arrondis.
 */
function empreinteDepuisLignes(f: FicheParsee, lignesRetenues: LigneEmpreinte[]): string {
  const lignes = lignesRetenues.map((l, index) => [
    normaliserDesignation(l.designation),
    normaliserUnite(l.unite),
    arrondir(l.quantite ?? 0, DECIMALES_QUANTITE).toString(),
    index,
  ].join("~"));
  return [
    // `type` et `actif` n'existent pas dans le classeur : l'import écrit TOUJOURS "PLAT" / true
    // (cf. la création plus bas). Une fiche manuelle identique mais typée BAR, ou désactivée, doit
    // donc être jugée DIVERGENTE — sinon --force la supprimerait et la recréerait en PLAT/actif.
    f.nom.trim(), f.categorie?.trim() ?? "—", "PLAT",
    f.nbPortions !== null && f.nbPortions > 0 ? Math.round(f.nbPortions) : 1,
    f.tauxTVA === null ? "0.16" : arrondir(f.tauxTVA, 4).toString(),
    f.prixVenteTTC === null ? "—" : arrondir(f.prixVenteTTC, DECIMALES_PRIX).toString(),
    f.coefficientMargeCible === null ? "—" : arrondir(f.coefficientMargeCible, 4).toString(),
    f.estSousRecette,
    f.rendementQuantiteG === null ? "—" : arrondir(f.rendementQuantiteG, 3).toString(),
    f.rendementQuantiteG === null ? "—" : "g",
    f.recette ?? "—", true, ...lignes,
  ].join("|");
}

/** La même empreinte, calculée sur ce que l'import COMPLET écrirait (mêmes arrondis, même ordre). */
function empreinteClasseur(f: FicheParsee, res: ResultatParse): string {
  return empreinteDepuisLignes(
    f,
    res.lignes
      .filter((l) => l.fiche === f && l.rattachement.type !== "AUCUN")
      .map((l) => ({
        designation:
          l.rattachement.type === "ARTICLE" ? l.rattachement.article.designation
            : l.rattachement.type === "SOUS_RECETTE" ? l.rattachement.fiche.nom : "?",
        unite: l.ingredient.unite,
        quantite: l.ingredient.quantite,
      })),
  );
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

/**
 * `--conserver-prix-existants` garde la valeur de base (le bon comportement), mais taire l'écart
 * ne l'est pas : si le classeur donne un prix différent de celui conservé, c'est listé ici sous un
 * intitulé distinct plutôt que noyé (ou disparu) dans `ecrasementsPrix`.
 */
export type PrixConserve = {
  designation: string;
  champ: "prix à l'unité" | "prix carton";
  /** Valeur restée en base (celle que l'import a préservée). */
  base: string;
  /** Valeur du classeur, NON appliquée : base et classeur divergent. */
  classeur: string;
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
  /** Prix conservés (--conserver-prix-existants) alors que le classeur donne une autre valeur. */
  prixConserves: PrixConserve[];
};

/** Client réduit à ce dont la suppression en ordre de dépendance a besoin (les deux modes). */
type ClientSuppression = {
  ficheTechnique: { deleteMany(args: unknown): Promise<{ count: number }> };
  ingredientFiche: { findMany(args: unknown): Promise<{ ficheId: string; sousFicheId: string | null }[]> };
};

/**
 * Suppression en ORDRE DE DÉPENDANCE. `IngredientFiche.sousFicheId` est en `onDelete: Restrict`,
 * non déférable en PostgreSQL : supprimer une sous-recette encore citée échoue immédiatement. On
 * retire donc par vagues ce que plus personne ne cite (les plats d'abord, les sous-recettes
 * ensuite), quelle que soit la profondeur d'imbrication.
 *
 * `supprimees` est REMPLI AU FUR ET À MESURE (et non renvoyé seulement en cas de succès) : un
 * blocage peut survenir APRÈS des suppressions, et l'opérateur doit alors avoir la liste exacte de
 * ce qui vient d'être détruit — une destruction sans trace serait le pire des rapports.
 */
async function supprimerEnOrdreDeDependance(
  prisma: ClientSuppression,
  aSupprimer: { id: string; nom: string }[],
  supprimees: string[],
): Promise<{ ok: true } | { ok: false; protegees: string[]; message: string }> {
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
        ok: false,
        protegees: restants.map((f) => f.nom),
        message:
          `ABANDON : ${restants.length} sous-recette(s) (${restants.map((f) => `« ${f.nom} »`).join(", ")}) sont ` +
          `encore citées comme ingrédient par ${bloqueurs.length} ligne(s) de fiches HORS classeur. Les supprimer ` +
          "violerait `IngredientFiche.sousFicheId` (onDelete: Restrict). " +
          (supprimees.length > 0
            ? `${supprimees.length} fiche(s) ONT DÉJÀ ÉTÉ SUPPRIMÉE(S) avant ce blocage et n'ont PAS été réécrites ` +
              `(${supprimees.map((n) => `« ${n} »`).join(", ")}) : elles sont à réimporter. `
            : "Rien de plus n'a été écrit. ") +
          "Détache ces lignes, ou autorise la suppression des fiches qui les portent.",
      };
    }
    await prisma.ficheTechnique.deleteMany({ where: { id: { in: supprimables.map((f) => f.id) } } });
    supprimees.push(...supprimables.map((f) => f.nom));
    const supprimes = new Set(supprimables.map((f) => f.id));
    restants = restants.filter((f) => !supprimes.has(f.id));
  }
  return { ok: true };
}

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
    ecrasementsPrix: [] as EcrasementPrix[], prixConserves: [] as PrixConserve[],
  };
  const autorisees = new Set((options.supprimerNommement ?? []).map((n) => n.trim()));

  // ── Idempotence. Le marqueur est la clé naturelle (les noms du classeur), rapprochée par
  //    DÉSIGNATION NORMALISÉE — comme les articles et les ingrédients — et non au caractère près :
  //    une « bolognaise » en minuscule ou une « Bolognaise » avec une espace finale, saisie à la
  //    main, doit être détectée comme homonyme (et donc jugée divergente, cf. empreinteClasseur),
  //    pas ignorée par un `where nom: in [...]` exact qui laisserait créer un DOUBLON en base.
  //    MAIS « une fiche homonyme existe » ne veut pas dire « import déjà fait » : il faut qu'elles y
  //    soient TOUTES et qu'elles soient toutes conformes. Sinon une seule « Carbonara » saisie à la
  //    main ferait afficher « déjà importé » et n'importerait rien du tout — en silence.
  const parNom = new Map(res.fiches.map((f) => [f.nom, f]));
  const parCleNom = new Map(res.fiches.map((f) => [normaliserDesignation(f.nom), f]));
  const toutesFiches = await prisma.ficheTechnique.findMany({ select: SELECT_FICHE_SIGNATURE });
  const existantes = toutesFiches.filter((e) => parCleNom.has(normaliserDesignation(e.nom)));

  const conformes: FicheEnBase[] = [];
  const divergentes: FicheEnBase[] = [];
  for (const e of existantes) {
    const duClasseur = parCleNom.get(normaliserDesignation(e.nom));
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

  if (aSupprimer.length > 0) {
    const r = await supprimerEnOrdreDeDependance(prisma, aSupprimer, rapport.fichesSupprimees);
    if (!r.ok) return { ...rapport, statut: "ABANDON", fichesProtegees: r.protegees, message: r.message };
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
        if (avant === apres) continue;
        if (prixConserve) {
          // Conserver la valeur est le bon comportement ; se taire sur l'écart ne l'est pas.
          rapport.prixConserves.push({ designation: a.designation, champ, base: avant, classeur: apres });
        } else {
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

// ═════════════════════════════════════════════════════════════════════════════
// MODE « FICHES SEULES » — on veut les fiches, on ne touche pas au catalogue
// ═════════════════════════════════════════════════════════════════════════════
//
// Tout ce qui suit est une ADDITION : rien au-dessus n'est modifié, et RIEN ici n'écrit dans
// `ArticleStock`. La garantie n'est pas un `if` que l'on pourrait oublier de prendre : les types
// de client de ce mode n'exposent AUCUNE méthode d'écriture sur cette table, et la transaction de
// création n'a même pas de propriété `articleStock`.

/** Article du catalogue CIBLE (lu en base), réduit à ce dont ce mode a besoin. */
export type ArticleCatalogue = {
  id: string;
  designation: string;
  unite: string | null;
  prixUnitaireUSD: Dec | null;
};

/** Rattachement d'un ingrédient dans ce mode : au catalogue CIBLE, jamais au classeur. */
export type RattachementCible =
  | { type: "ARTICLE"; article: ArticleCatalogue }
  | { type: "SOUS_RECETTE"; fiche: FicheParsee }
  | { type: "AUCUN" };

export type LigneFichesSeules = {
  fiche: FicheParsee;
  ingredient: IngredientParse;
  rattachement: RattachementCible;
};

export type FicheRefusee = {
  nom: string;
  onglet: string;
  /** Désignations, TELLES QU'ÉCRITES AU CLASSEUR, des articles introuvables au catalogue cible. */
  articlesManquants: string[];
  /** Sous-recettes elles-mêmes refusées que cette fiche cite (refus par cascade). */
  sousRecettesRefusees: string[];
};

/**
 * Article du catalogue cible ressemblant à un article introuvable. C'est une SUGGESTION À
 * VÉRIFIER par un humain, JAMAIS une décision : rien n'est rattaché sur cette base.
 */
export type Sosie = {
  designation: string;
  distance: number;
  /** 1 = identique, 0 = rien en commun. Simple 1 − distance/longueur. */
  similarite: number;
  /**
   * Les conditionnements lus dans les deux désignations DIFFÈRENT (« 1 L » contre « 5 L ») :
   * ce ne sont alors PAS le même article, quelle que soit la ressemblance des lettres.
   */
  conditionnementDifferent: boolean;
};

export type ArticleManquant = {
  /** Désignation telle qu'écrite au classeur (1ʳᵉ occurrence rencontrée). */
  designation: string;
  cle: string;
  /** Nombre de lignes d'ingrédient qui le réclament — sert au tri « du plus utilisé au moins ». */
  occurrences: number;
  /** Fiches qui le réclament (dédoublonnées). */
  fiches: string[];
  sosie: Sosie | null;
  /**
   * Ligne de la « Liste des articles » du classeur portant cette désignation, ou `null` s'il n'y
   * figure pas. C'est la SEULE source de valeurs pour `--creer-articles-manquants` : sans elle, on
   * ne crée rien (on ne devine ni une unité, ni un prix).
   */
  valeursClasseur: LigneArticle | null;
  /** Unités de consommation lues dans les recettes — utile pour juger l'unité à donner à l'article. */
  unitesRecette: string[];
};

/** Une correspondance qui a effectivement redirigé au moins un ingrédient vers le catalogue. */
export type CorrespondanceAppliquee = {
  entree: Correspondance;
  /** L'article du catalogue, tel qu'il est en base : c'est LUI qui fait foi (unité, prix). */
  article: ArticleCatalogue;
  occurrences: number;
  fiches: string[];
  /** Unités de consommation des lignes de recette ainsi redirigées. */
  unitesRecette: string[];
};

/**
 * Correspondance dont la désignation de classeur n'apparaît dans AUCUNE fiche de ce classeur.
 * Non bloquante (elle ne peut créer aucun doublon), mais SIGNALÉE : une table qui pourrit en
 * silence finit par mentir.
 */
export type CorrespondanceInutilisee = {
  entree: Correspondance;
  /** La cible existe-t-elle malgré tout au catalogue ? Non ⇒ entrée doublement suspecte. */
  cibleAuCatalogue: boolean;
};

/**
 * Ingrédient rattaché à un article dont l'unité d'achat NE SE CONVERTIT PAS avec l'unité de
 * consommation de la recette : le coût sortira PARTIEL (motif `UNITE_INCONVERTIBLE` du moteur).
 * SIGNALÉ, jamais corrigé — aucune conversion n'est devinée.
 */
export type UniteNonConvertible = {
  /** Désignation telle qu'écrite au classeur. */
  designationClasseur: string;
  /** Article du catalogue effectivement rattaché. */
  articleCatalogue: string;
  uniteRecette: string;
  uniteCatalogue: string | null;
  /** Le rattachement passe-t-il par une correspondance arbitrée ? */
  parCorrespondance: boolean;
  /** L'article vient-il d'être créé par `--creer-articles-manquants` ? */
  articleCree: boolean;
  occurrences: number;
  fiches: string[];
};

export type PlanFichesSeules = {
  /** Fiches créables, DANS L'ORDRE DE CRÉATION : sous-recettes d'abord, plats ensuite. */
  creables: FicheParsee[];
  refusees: FicheRefusee[];
  /** Toutes les lignes du classeur, rattachées au catalogue CIBLE (fiches refusées comprises). */
  lignes: LigneFichesSeules[];
  /** Articles introuvables, DÉDOUBLONNÉS, du plus utilisé au moins utilisé. */
  articlesManquants: ArticleManquant[];
  /** Deux articles du catalogue cible portant la MÊME désignation normalisée : rattachement ambigu. */
  ambiguitesCatalogue: { cle: string; designations: string[] }[];
  nbArticlesCatalogue: number;
  /** Correspondances arbitrées qui ont effectivement redirigé un rattachement. */
  correspondancesAppliquees: CorrespondanceAppliquee[];
  /** Correspondances dont la désignation de classeur ne figure dans aucune fiche : à relire. */
  correspondancesInutilisees: CorrespondanceInutilisee[];
  /** Rattachements dont l'unité ne se convertira pas : coût PARTIEL annoncé, jamais deviné. */
  unitesNonConvertibles: UniteNonConvertible[];
};

/** Options de planification. Aucune n'écrit quoi que ce soit : `planifierFichesSeules` reste PUR. */
export type OptionsPlan = {
  /** Table arbitrée par la Direction (fichier versionné). Absente = comportement d'origine. */
  correspondances?: Correspondance[];
  /**
   * Clés d'articles qui viennent d'être CRÉÉS (ou le seraient) par `--creer-articles-manquants` :
   * sert uniquement à les marquer comme tels dans les signalements d'unité.
   */
  clesArticlesCrees?: Set<string>;
};

// ─── Sosies : distance de chaîne, pour SUGGÉRER, jamais pour rattacher ───────

/**
 * Distance de Levenshtein (insertion / suppression / substitution), en O(n·m) sur deux lignes.
 * Sert UNIQUEMENT à proposer un sosie à l'œil humain dans le rapport de simulation.
 */
export function distanceChaine(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  let courante = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    courante[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      courante[j] = Math.min(courante[j - 1]! + 1, precedente[j]! + 1, precedente[j - 1]! + cout);
    }
    [precedente, courante] = [courante, precedente];
  }
  return precedente[b.length]!;
}

/** Sous ce degré de ressemblance, on ne propose RIEN : une suggestion absurde ferait perdre du temps. */
const SEUIL_SOSIE = 0.55;

// « 1L », « 500 GR », « 12 X 1KG » : quantité COLLÉE à une unité de mesure. Deux désignations dont
// ces couples diffèrent désignent des conditionnements différents — jamais le même article.
const CONDITIONNEMENT_LU = /(\d+(?:[.,]\d+)?)\s*(kgs?|grammes?|gr|g|litres?|ltr|lt|l|cl|ml)\b/g;

function conditionnements(cle: string): string {
  return [...cle.matchAll(CONDITIONNEMENT_LU)]
    .map((m) => `${m[1]!.replace(",", ".")}${m[2]!}`)
    .sort()
    .join("+");
}

/** Meilleur sosie d'une clé parmi le catalogue cible, ou `null` s'il n'y a rien de ressemblant. */
function chercherSosie(cle: string, catalogue: Map<string, ArticleCatalogue>): Sosie | null {
  let meilleur: { cle: string; distance: number } | null = null;
  for (const candidat of catalogue.keys()) {
    const distance = distanceChaine(cle, candidat);
    if (meilleur === null || distance < meilleur.distance) meilleur = { cle: candidat, distance };
  }
  if (meilleur === null) return null;

  const longueur = Math.max(cle.length, meilleur.cle.length, 1);
  const similarite = 1 - meilleur.distance / longueur;
  if (similarite < SEUIL_SOSIE) return null;

  return {
    designation: catalogue.get(meilleur.cle)!.designation,
    distance: meilleur.distance,
    similarite,
    conditionnementDifferent: conditionnements(cle) !== conditionnements(meilleur.cle),
  };
}

// ─── Correspondances arbitrées (fichier de données VERSIONNÉ, relisible) ─────

/**
 * Une correspondance ARBITRÉE PAR LA DIRECTION : « cette désignation du classeur et cet article
 * DÉJÀ au catalogue sont le même produit ».
 *
 * Elle n'écrit RIEN : elle redirige un rattachement, un point c'est tout. L'article du catalogue
 * FAIT FOI — c'est SON unité et SON prix qui servent au calcul. Le conditionnement lu dans le nom
 * du classeur (« 1KG », « 240g ») ne devient pas une donnée d'article : il vit dans l'unité et la
 * quantité de la ligne d'ingrédient.
 */
export type Correspondance = {
  /** Désignation TELLE QU'ÉCRITE dans le classeur (colonne « Article » d'une fiche). */
  classeur: string;
  /** Désignation de l'article DÉJÀ présent au catalogue `ArticleStock`. */
  catalogue: string;
  /** Pourquoi ces deux désignations sont le même produit. Une phrase, relue par la Direction. */
  motif: string;
};

/** Emplacement du fichier de données. Versionné à côté du script, JAMAIS noyé dans le code. */
export const CHEMIN_CORRESPONDANCES = fileURLToPath(
  new URL("./correspondances-articles-fiches.json", import.meta.url),
);

function estTexteNonVide(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Valide la table de correspondances et REFUSE tout ce qui est ambigu, plutôt que de l'interpréter :
 * entrée mal formée, motif absent (une correspondance sans raison écrite n'est pas relisible),
 * correspondance vers elle-même, deux entrées pour la MÊME désignation de classeur, ou chaînage
 * (A → B et B → C : on ne résout jamais transitivement, cela masquerait une erreur d'arbitrage).
 */
export function validerCorrespondances(brut: unknown, source: string): Correspondance[] {
  const racine = brut as { correspondances?: unknown } | null;
  if (racine === null || typeof racine !== "object" || !Array.isArray(racine.correspondances)) {
    throw new Error(
      `Table de correspondances illisible (${source}) : il faut un objet JSON avec un tableau ` +
        "« correspondances ». Rien n'a été lu, rien n'a été écrit.",
    );
  }

  const entrees: Correspondance[] = [];
  racine.correspondances.forEach((e, index) => {
    const rang = `entrée n°${index + 1}`;
    if (e === null || typeof e !== "object") {
      throw new Error(`Table de correspondances (${source}) : ${rang} n'est pas un objet.`);
    }
    const { classeur, catalogue, motif } = e as Record<string, unknown>;
    if (!estTexteNonVide(classeur) || !estTexteNonVide(catalogue)) {
      throw new Error(
        `Table de correspondances (${source}) : ${rang} doit porter « classeur » et « catalogue », ` +
          "deux textes non vides.",
      );
    }
    if (!estTexteNonVide(motif)) {
      throw new Error(
        `Table de correspondances (${source}) : ${rang} (« ${classeur} » → « ${catalogue} ») n'a pas de ` +
          "« motif ». Une correspondance sans raison écrite n'est pas relisible par la Direction : refusée.",
      );
    }
    if (normaliserDesignation(classeur) === normaliserDesignation(catalogue)) {
      throw new Error(
        `Table de correspondances (${source}) : ${rang} pointe « ${classeur} » sur lui-même — sans effet, ` +
          "donc probablement une erreur de saisie. Refusée plutôt qu'ignorée en silence.",
      );
    }
    entrees.push({ classeur: classeur.trim(), catalogue: catalogue.trim(), motif: motif.trim() });
  });

  const parCle = new Map<string, Correspondance>();
  for (const e of entrees) {
    const cle = normaliserDesignation(e.classeur);
    const deja = parCle.get(cle);
    if (deja) {
      throw new Error(
        `Table de correspondances (${source}) : « ${e.classeur} » figure DEUX FOIS, vers « ${deja.catalogue} » ` +
          `puis vers « ${e.catalogue} ». Laquelle fait foi ? On ne tranche pas à la place de la Direction.`,
      );
    }
    parCle.set(cle, e);
  }

  for (const e of entrees) {
    const suite = parCle.get(normaliserDesignation(e.catalogue));
    if (suite) {
      throw new Error(
        `Table de correspondances (${source}) : « ${e.classeur} » pointe sur « ${e.catalogue} », qui est ` +
          `lui-même redirigé vers « ${suite.catalogue} ». Les correspondances ne se résolvent JAMAIS en ` +
          "chaîne — un chaînage cache toujours un arbitrage à refaire.",
      );
    }
  }

  return entrees;
}

/** Index des correspondances par désignation NORMALISÉE du classeur (la clé de rapprochement). */
export function indexerCorrespondances(entrees: Correspondance[]): Map<string, Correspondance> {
  return new Map(entrees.map((e) => [normaliserDesignation(e.classeur), e]));
}

/** Lit et valide le fichier de données versionné. Toute anomalie ARRÊTE tout, avant la moindre lecture de base. */
export function chargerCorrespondances(chemin: string = CHEMIN_CORRESPONDANCES): Correspondance[] {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(chemin, "utf8"));
  } catch (e) {
    throw new Error(
      `Table de correspondances : impossible de lire « ${chemin} » (${e instanceof Error ? e.message : String(e)}). ` +
        "Rien n'a été écrit.",
    );
  }
  return validerCorrespondances(brut, chemin);
}

/**
 * L'unité de consommation de la recette se convertit-elle avec l'unité d'achat de l'article ?
 *
 * Reproduit à l'identique la règle de `prixParUniteDeConsommation` (src/lib/fiches/cout.ts, NON
 * modifié) : conversion directe, sinon unité-emballage (« 500 GR ») ramenée au kilo. Sert
 * UNIQUEMENT À SIGNALER — aucune conversion n'est devinée, aucune unité n'est corrigée.
 */
export function uniteSeConvertit(uniteRecette: string, uniteArticle: string | null): boolean {
  if (uniteArticle === null || uniteArticle.trim() === "") return false;
  if (facteur(uniteRecette, uniteArticle) !== null) return true;
  const poids = poidsEmballage(uniteArticle);
  return poids !== null && poids.greaterThan(0) && facteur(uniteRecette, "kg") !== null;
}

// ─── Plan (PUR : aucune base, aucun effet) ───────────────────────────────────

/**
 * Décide, SANS RIEN ÉCRIRE, ce que le mode fiches seules ferait face à ce catalogue-là.
 *
 * Règle cardinale : une fiche dont au moins un ingrédient ne se rattache pas n'est PAS créée.
 * `IngredientFiche` n'a aucun champ de libellé — une ligne sans article ni sous-fiche serait
 * invisible à l'écran, et la fiche présenterait un coût amputé sous l'apparence d'un coût complet.
 * Le refus se propage : une fiche qui cite une sous-recette refusée est refusée à son tour.
 *
 * Les CORRESPONDANCES arbitrées (option) redirigent une désignation du classeur vers un article
 * DÉJÀ au catalogue. Elles ne modifient jamais cet article : il fait foi tel qu'il est. Une
 * correspondance UTILISÉE dont la cible est absente du catalogue LÈVE — cf. `options`.
 */
export function planifierFichesSeules(
  res: ResultatParse,
  catalogue: ArticleCatalogue[],
  options: OptionsPlan = {},
): PlanFichesSeules {
  // Index du catalogue CIBLE par désignation normalisée — la même clé que partout ailleurs.
  const parCle = new Map<string, ArticleCatalogue>();
  const ambigus = new Map<string, string[]>();
  const tri = [...catalogue].sort((a, b) => a.designation.localeCompare(b.designation) || a.id.localeCompare(b.id));
  for (const a of tri) {
    const cle = normaliserDesignation(a.designation);
    const deja = parCle.get(cle);
    if (deja) {
      // Deux articles du catalogue portent la même désignation normalisée : le rattachement est
      // ambigu. On retient le premier dans un ordre DÉTERMINISTE (désignation puis id) et on le
      // signale — jamais de fusion silencieuse, jamais de tirage au sort d'une exécution à l'autre.
      const liste = ambigus.get(cle) ?? [deja.designation];
      liste.push(a.designation);
      ambigus.set(cle, liste);
      continue;
    }
    parCle.set(cle, a);
  }

  const parCleFiche = new Map<string, FicheParsee>();
  for (const f of res.fiches) for (const c of f.cles) if (!parCleFiche.has(c)) parCleFiche.set(c, f);

  // ── Correspondances arbitrées : « cette désignation du classeur EST cet article du catalogue ».
  // La cible est cherchée par la MÊME clé de rapprochement que partout ailleurs.
  const correspondances = options.correspondances ?? [];
  const parCleCorrespondance = indexerCorrespondances(correspondances);
  // Clés RÉELLEMENT arbitrables : celles des lignes d'ingrédient qui ne désignent pas déjà une
  // sous-recette (la sous-recette garde la priorité, comme avant — rien n'est changé de ce côté).
  const clesConsommees = new Set(
    res.fiches.flatMap((f) =>
      f.ingredients.filter((i) => (parCleFiche.get(i.cle) ?? f) === f).map((i) => i.cle),
    ),
  );

  // Une correspondance UTILISÉE dont la cible n'existe pas dans la base visée est MORTE : sans ce
  // refus, l'ingrédient retomberait dans les « manquants » et --creer-articles-manquants créerait
  // un DOUBLON du produit que la Direction voulait justement rapprocher.
  const mortes = correspondances.filter(
    (e) =>
      clesConsommees.has(normaliserDesignation(e.classeur)) &&
      !parCle.has(normaliserDesignation(e.catalogue)),
  );
  if (mortes.length > 0) {
    throw new Error(
      `ABANDON : ${mortes.length} correspondance(s) arbitrée(s) ne résolvent PAS sur ce catalogue — leur ` +
        "article cible n'y existe pas :\n" +
        mortes
          .map((e) => `  • « ${e.classeur} » → « ${e.catalogue} » (INTROUVABLE au catalogue) — motif : ${e.motif}`)
          .join("\n") +
        "\nRien n'a été écrit. Corrige la désignation cible dans scripts/correspondances-articles-fiches.json " +
        "(ou fais créer l'article au catalogue), puis relance. Une correspondance morte qui passerait " +
        "inaperçue ferait créer un DOUBLON.",
    );
  }

  // Rattachement : sous-recette d'abord (elles ne dépendent pas du catalogue pour exister),
  // puis article DU CATALOGUE CIBLE — directement, ou via la correspondance arbitrée. Jamais
  // « au plus proche ».
  const appliquees = new Map<string, CorrespondanceAppliquee>();
  const lignes: LigneFichesSeules[] = [];
  for (const f of res.fiches) {
    for (const i of f.ingredients) {
      const sous = parCleFiche.get(i.cle);
      if (sous && sous !== f) {
        lignes.push({ fiche: f, ingredient: i, rattachement: { type: "SOUS_RECETTE", fiche: sous } });
        continue;
      }

      const direct = parCle.get(i.cle);
      const entree = direct ? undefined : parCleCorrespondance.get(i.cle);
      const article = direct ?? (entree ? parCle.get(normaliserDesignation(entree.catalogue)) : undefined);

      if (article && entree) {
        const vue = appliquees.get(i.cle);
        if (vue) {
          vue.occurrences++;
          if (!vue.fiches.includes(f.nom)) vue.fiches.push(f.nom);
          if (!vue.unitesRecette.includes(i.unite)) vue.unitesRecette.push(i.unite);
        } else {
          appliquees.set(i.cle, {
            entree,
            article,
            occurrences: 1,
            fiches: [f.nom],
            unitesRecette: [i.unite],
          });
        }
      }

      lignes.push({
        fiche: f,
        ingredient: i,
        rattachement: article ? { type: "ARTICLE", article } : { type: "AUCUN" },
      });
    }
  }

  const lignesDe = new Map<FicheParsee, LigneFichesSeules[]>();
  for (const l of lignes) {
    const liste = lignesDe.get(l.fiche) ?? [];
    liste.push(l);
    lignesDe.set(l.fiche, liste);
  }

  // 1ᵉʳ motif de refus : un article introuvable.
  const refusees = new Set<FicheParsee>();
  for (const f of res.fiches) {
    if ((lignesDe.get(f) ?? []).some((l) => l.rattachement.type === "AUCUN")) refusees.add(f);
  }

  // 2ᵉ motif, par CASCADE : citer une fiche refusée. Point fixe — s'arrête forcément, chaque tour
  // n'ajoute que des fiches (ensemble fini) et un cycle éventuel reste simplement créable.
  for (let bouge = true; bouge; ) {
    bouge = false;
    for (const f of res.fiches) {
      if (refusees.has(f)) continue;
      const cite = (lignesDe.get(f) ?? []).some(
        (l) => l.rattachement.type === "SOUS_RECETTE" && refusees.has(l.rattachement.fiche),
      );
      if (cite) {
        refusees.add(f);
        bouge = true;
      }
    }
  }

  // Ordre de création INCHANGÉ : sous-recettes d'abord, plats ensuite.
  const creables = [...res.sousRecettes, ...res.plats].filter((f) => !refusees.has(f));

  const listeRefusees: FicheRefusee[] = [...res.sousRecettes, ...res.plats]
    .filter((f) => refusees.has(f))
    .map((f) => ({
      nom: f.nom,
      onglet: f.onglet,
      articlesManquants: (lignesDe.get(f) ?? [])
        .filter((l) => l.rattachement.type === "AUCUN")
        .map((l) => l.ingredient.designation),
      sousRecettesRefusees: [
        ...new Set(
          (lignesDe.get(f) ?? [])
            .filter((l) => l.rattachement.type === "SOUS_RECETTE" && refusees.has(l.rattachement.fiche))
            .map((l) => (l.rattachement as { type: "SOUS_RECETTE"; fiche: FicheParsee }).fiche.nom),
        ),
      ],
    }));

  // Liste de travail pour la Direction : articles introuvables DÉDOUBLONNÉS, du plus utilisé au
  // moins utilisé, avec le sosie le plus proche en SUGGESTION.
  const parCleClasseur = new Map<string, LigneArticle>();
  for (const a of res.articles) if (!parCleClasseur.has(a.cle)) parCleClasseur.set(a.cle, a);

  const manquants = new Map<string, ArticleManquant>();
  for (const l of lignes) {
    if (l.rattachement.type !== "AUCUN") continue;
    const existant = manquants.get(l.ingredient.cle);
    if (existant) {
      existant.occurrences++;
      if (!existant.fiches.includes(l.fiche.nom)) existant.fiches.push(l.fiche.nom);
      if (!existant.unitesRecette.includes(l.ingredient.unite)) existant.unitesRecette.push(l.ingredient.unite);
      continue;
    }
    manquants.set(l.ingredient.cle, {
      designation: l.ingredient.designation,
      cle: l.ingredient.cle,
      occurrences: 1,
      fiches: [l.fiche.nom],
      sosie: chercherSosie(l.ingredient.cle, parCle),
      // Seule source de valeurs pour une création : la « Liste des articles » du classeur.
      // Absente ⇒ on ne crée rien pour cet article (on ne devine ni unité, ni prix).
      valeursClasseur: parCleClasseur.get(l.ingredient.cle) ?? null,
      unitesRecette: [l.ingredient.unite],
    });
  }

  // Unités qui ne se convertiront pas : le coût sera PARTIEL, on l'annonce ligne par ligne. C'est
  // la conséquence directe de « l'article du catalogue fait foi » — son unité peut ne pas parler
  // la même langue que l'unité de consommation de la recette.
  const clesCrees = options.clesArticlesCrees ?? new Set<string>();
  const inconvertibles = new Map<string, UniteNonConvertible>();
  for (const l of lignes) {
    if (l.rattachement.type !== "ARTICLE") continue;
    const uniteArticle = l.rattachement.article.unite;
    if (uniteSeConvertit(l.ingredient.unite, uniteArticle)) continue;
    const cle = `${l.ingredient.cle}~${normaliserUnite(l.ingredient.unite)}`;
    const vue = inconvertibles.get(cle);
    if (vue) {
      vue.occurrences++;
      if (!vue.fiches.includes(l.fiche.nom)) vue.fiches.push(l.fiche.nom);
      continue;
    }
    inconvertibles.set(cle, {
      designationClasseur: l.ingredient.designation,
      articleCatalogue: l.rattachement.article.designation,
      uniteRecette: l.ingredient.unite,
      uniteCatalogue: uniteArticle,
      parCorrespondance: appliquees.has(l.ingredient.cle),
      articleCree: clesCrees.has(normaliserDesignation(l.rattachement.article.designation)),
      occurrences: 1,
      fiches: [l.fiche.nom],
    });
  }

  return {
    creables,
    refusees: listeRefusees,
    lignes,
    articlesManquants: [...manquants.values()].sort(
      (a, b) => b.occurrences - a.occurrences || a.designation.localeCompare(b.designation),
    ),
    ambiguitesCatalogue: [...ambigus].map(([cle, designations]) => ({ cle, designations })),
    nbArticlesCatalogue: catalogue.length,
    correspondancesAppliquees: [...appliquees.values()].sort(
      (a, b) => b.occurrences - a.occurrences || a.entree.classeur.localeCompare(b.entree.classeur),
    ),
    correspondancesInutilisees: correspondances
      .filter((e) => !appliquees.has(normaliserDesignation(e.classeur)))
      .map((e) => ({ entree: e, cibleAuCatalogue: parCle.has(normaliserDesignation(e.catalogue)) })),
    unitesNonConvertibles: [...inconvertibles.values()].sort(
      (a, b) => b.occurrences - a.occurrences || a.designationClasseur.localeCompare(b.designationClasseur),
    ),
  };
}

// ─── Création CIBLÉE des articles absents (`--creer-articles-manquants`) ─────

/**
 * Article que `--creer-articles-manquants` créerait, avec ses valeurs LUES AU CLASSEUR, déjà
 * arrondies comme le schéma l'exige. Ni catégorie, ni fournisseur : le classeur n'en donne pas de
 * fiable, et on n'invente rien — la Direction complétera.
 */
export type ArticleACreer = {
  designation: string;
  cle: string;
  domaine: "NOURRITURE";
  unite: string | null;
  uniteParCarton: string | null;
  prixUnitaireUSD: string | null;
  prixCartonUSD: string | null;
  /** Nombre de lignes de recette qui le réclament, et fiches concernées. */
  occurrences: number;
  fiches: string[];
  /** Unités de consommation des recettes : à confronter à `unite` avant de valider. */
  unitesRecette: string[];
};

/**
 * Ce que `--creer-articles-manquants` créerait sur ce plan, et ce qu'il ne peut PAS créer.
 *
 * Un article introuvable qui ne figure pas non plus dans la « Liste des articles » du classeur n'a
 * AUCUNE valeur connue : ni unité, ni prix. On ne le crée pas — sa fiche reste refusée et il est
 * signalé. Deviner une unité reviendrait à fabriquer un coût.
 */
export function articlesACreer(plan: PlanFichesSeules): {
  aCreer: ArticleACreer[];
  sansValeurs: ArticleManquant[];
} {
  const aCreer: ArticleACreer[] = [];
  const sansValeurs: ArticleManquant[] = [];

  for (const m of plan.articlesManquants) {
    const v = m.valeursClasseur;
    if (v === null) {
      sansValeurs.push(m);
      continue;
    }
    aCreer.push({
      // La désignation écrite est celle de la LISTE DES ARTICLES du classeur (source des valeurs),
      // et non celle de la ligne de recette : les deux ont la même clé de rapprochement.
      designation: v.designation,
      cle: m.cle,
      domaine: "NOURRITURE",
      unite: v.unite,
      uniteParCarton: v.uniteParCarton === null ? null : arrondir(v.uniteParCarton, 2).toString(),
      prixUnitaireUSD: v.prixUnitaireUSD === null ? null : arrondir(v.prixUnitaireUSD, DECIMALES_PRIX).toString(),
      prixCartonUSD: v.prixCartonUSD === null ? null : arrondir(v.prixCartonUSD, DECIMALES_PRIX).toString(),
      occurrences: m.occurrences,
      fiches: m.fiches,
      unitesRecette: m.unitesRecette,
    });
  }

  return { aCreer, sansValeurs };
}

/**
 * Catalogue tel qu'il SERAIT après création — pour la SIMULATION uniquement (les identifiants sont
 * factices et le disent). Rien n'est écrit : c'est une projection en mémoire.
 */
export function projeterCatalogue(catalogue: ArticleCatalogue[], aCreer: ArticleACreer[]): ArticleCatalogue[] {
  return [
    ...catalogue,
    ...aCreer.map((a) => ({
      id: `(à créer) ${a.cle}`,
      designation: a.designation,
      unite: a.unite,
      prixUnitaireUSD: a.prixUnitaireUSD === null ? null : new Decimal(a.prixUnitaireUSD),
    })),
  ];
}

/** L'empreinte de contenu, calculée sur ce que le mode fiches seules écrirait pour cette fiche. */
function empreinteFichesSeules(f: FicheParsee, plan: PlanFichesSeules): string {
  return empreinteDepuisLignes(
    f,
    plan.lignes
      .filter((l) => l.fiche === f)
      .map((l) => ({
        designation:
          l.rattachement.type === "ARTICLE" ? l.rattachement.article.designation
            : l.rattachement.type === "SOUS_RECETTE" ? l.rattachement.fiche.nom : "?",
        unite: l.ingredient.unite,
        quantite: l.ingredient.quantite,
      })),
  );
}

// ─── Simulation du coût sur le catalogue CIBLE ───────────────────────────────

/**
 * Chiffre les fiches CRÉABLES avec les prix et les unités DU CATALOGUE CIBLE (et non ceux du
 * classeur, qui ne seront pas écrits ici), en passant par le VRAI moteur (`calculerCout`, non
 * modifié). Les valeurs injectées sont celles TELLES QU'ELLES SERONT ÉCRITES (quantités à 3
 * décimales, portions arrondies) : le rapport annonce le coût que l'application affichera.
 */
export function simulerCoutsFichesSeules(plan: PlanFichesSeules): SimulationFiche[] {
  const idDe = (f: FicheParsee) => f.onglet;
  const fichesCalc = new Map<string, FicheCalc>();

  for (const f of plan.creables) {
    const ingredients: IngredientCalc[] = plan.lignes
      .filter((l) => l.fiche === f)
      .map((l) => {
        const base = {
          nom: l.ingredient.designation,
          unite: l.ingredient.unite,
          quantite: arrondir(l.ingredient.quantite ?? 0, DECIMALES_QUANTITE).toString(),
        };
        if (l.rattachement.type === "ARTICLE") {
          const a = l.rattachement.article;
          return {
            ...base,
            article: {
              prixUnitaireUSD: a.prixUnitaireUSD === null ? null : a.prixUnitaireUSD.toString(),
              unite: a.unite ?? "",
            },
          };
        }
        if (l.rattachement.type === "SOUS_RECETTE") return { ...base, sousFicheId: idDe(l.rattachement.fiche) };
        return base; // inatteignable pour une fiche créable : ses lignes sont TOUTES rattachées
      });

    fichesCalc.set(idDe(f), {
      id: idDe(f),
      nom: f.nom,
      nbPortions: f.nbPortions !== null && f.nbPortions > 0 ? Math.round(f.nbPortions) : 1,
      tauxTVA: f.tauxTVA === null ? 0.16 : f.tauxTVA, // défaut du schéma, comme à l'écriture
      prixVenteTTC: f.prixVenteTTC,
      coefficientMargeCible: f.coefficientMargeCible,
      estSousRecette: f.estSousRecette,
      rendementQuantite: f.rendementQuantiteG,
      rendementUnite: f.rendementQuantiteG === null ? null : "g",
      ingredients,
    });
  }

  const contexte = { fiches: fichesCalc };
  return plan.creables.map((f) => {
    const r = calculerCout(fichesCalc.get(idDe(f))!, contexte);
    const indetermine = r.incomplet && r.coutParPortion.isZero();
    return {
      nom: f.nom,
      incomplet: r.incomplet,
      motifs: r.ingredientsSansPrix,
      coutParPortion: indetermine ? null : r.coutParPortion.toDecimalPlaces(4).toString(),
      coutTotal: indetermine ? null : r.coutTotal,
      nbPortions: f.nbPortions !== null && f.nbPortions > 0 ? Math.round(f.nbPortions) : 1,
    };
  });
}

// ─── Écriture (fiches uniquement) ────────────────────────────────────────────

/**
 * Client du mode fiches seules. `articleStock` n'expose QUE `findMany` : il n'existe aucun moyen,
 * même par erreur de frappe, d'écrire dans le catalogue depuis ce type. C'est la garantie « par
 * construction » exigée — et non un drapeau que l'on pourrait oublier de tester.
 */
export type ClientFichesSeules = {
  ficheTechnique: {
    findMany(args: unknown): Promise<FicheEnBase[]>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  ingredientFiche: { findMany(args: unknown): Promise<{ ficheId: string; sousFicheId: string | null }[]> };
  /** LECTURE SEULE — volontairement dépourvu de `create` / `update` / `upsert` / `deleteMany`. */
  articleStock: { findMany(args: unknown): Promise<ArticleCatalogue[]> };
  $transaction<T>(fn: (tx: TxFichesSeules) => Promise<T>, options?: unknown): Promise<T>;
};

/** Transaction de création DES FICHES : AUCUNE propriété `articleStock`, donc aucun accès possible. */
type TxFichesSeules = {
  ficheTechnique: { create(args: { data: Record<string, unknown>; select: unknown }): Promise<{ id: string }> };
  ingredientFiche: { createMany(args: { data: unknown[] }): Promise<unknown> };
};

/**
 * `articleStock` du mode `--creer-articles-manquants` : `findMany` + `create`, et RIEN D'AUTRE.
 *
 * C'est la garantie centrale de ce drapeau. Ni `update`, ni `upsert`, ni `updateMany`, ni
 * `createMany` (qui contournerait le comptage), ni `delete` : ces méthodes N'EXISTENT PAS dans ce
 * type. Aucune ligne de code de ce mode ne peut donc MODIFIER un article existant, même par erreur
 * de frappe — l'inspection avait montré qu'une mise à jour effacerait 5 prix et triplerait celui du
 * Lard Fumé.
 */
export type ArticleStockCreationSeule = {
  findMany(args: unknown): Promise<ArticleCatalogue[]>;
  create(args: { data: Record<string, unknown> }): Promise<{ id: string; designation: string }>;
};

/** Client du mode fiches seules AVEC création ciblée. Seul `articleStock` change, et il ne GAGNE que `create`. */
export type ClientFichesSeulesCreation = Omit<ClientFichesSeules, "articleStock"> & {
  articleStock: ArticleStockCreationSeule;
};

export type OptionsFichesSeules = {
  force: boolean;
  /** Noms de fiches divergentes dont la suppression est autorisée NOMMÉMENT (`--supprimer`). */
  supprimerNommement?: string[];
  /** Table arbitrée par la Direction (fichier versionné). Absente = comportement d'origine. */
  correspondances?: Correspondance[];
  /** Sans le drapeau, AUCUNE création : les articles manquants le restent, les fiches sont refusées. */
  creerArticlesManquants?: false;
};

/** Les mêmes options, avec la création CIBLÉE ouverte — et le client qui va avec, exigé par le type. */
export type OptionsFichesSeulesCreation = Omit<OptionsFichesSeules, "creerArticlesManquants"> & {
  creerArticlesManquants: true;
};

/** Un article effectivement créé par `--creer-articles-manquants` (jamais une mise à jour). */
export type ArticleCree = ArticleACreer & { id: string };

/**
 * Rapport du mode fiches seules.
 *
 * Il n'y a PAS et il n'y aura JAMAIS de champ « articles mis à jour » : aucune mise à jour n'est
 * exprimable dans ce mode (cf. `ArticleStockCreationSeule`, qui ne déclare que `findMany` et
 * `create`). Un champ à 0 laisserait croire que la mise à jour était seulement possible.
 * `articlesCrees` n'existe que parce que `--creer-articles-manquants` crée réellement — et il liste
 * ce qui a été créé, valeur par valeur.
 */
export type RapportFichesSeules = {
  statut: "IMPORTE" | "DEJA_FAIT" | "ABANDON";
  message: string;
  fichesSupprimees: string[];
  fichesProtegees: string[];
  fichesCreees: number;
  ingredientsCrees: number;
  /** Fiches NON importées faute de rattachement — avec le nom exact des articles introuvables. */
  fichesRefusees: FicheRefusee[];
  /** Liste de travail : articles introuvables dédoublonnés, du plus utilisé au moins utilisé. */
  articlesManquants: ArticleManquant[];
  /** Articles CRÉÉS (jamais mis à jour) par `--creer-articles-manquants`. Vide sans ce drapeau. */
  articlesCrees: ArticleCree[];
  /** Articles introuvables qu'on a REFUSÉ de créer : le classeur ne leur donne aucune valeur. */
  articlesSansValeurs: ArticleManquant[];
  plan: PlanFichesSeules;
};

/**
 * Crée les fiches SANS METTRE À JOUR LE CATALOGUE.
 *
 * Par défaut, `ArticleStock` est LU (pour rattacher) et RIEN d'autre — cf. `ClientFichesSeules`.
 * Avec `creerArticlesManquants`, le client doit être un `ClientFichesSeulesCreation` : `create`
 * s'ajoute, et rien d'autre. Aucune mise à jour d'article n'est exprimable, dans aucun des deux cas.
 */
export async function ecrireFichesSeules(
  prisma: ClientFichesSeules,
  res: ResultatParse,
  options: OptionsFichesSeules,
): Promise<RapportFichesSeules>;
export async function ecrireFichesSeules(
  prisma: ClientFichesSeulesCreation,
  res: ResultatParse,
  options: OptionsFichesSeulesCreation,
): Promise<RapportFichesSeules>;
export async function ecrireFichesSeules(
  prisma: ClientFichesSeules | ClientFichesSeulesCreation,
  res: ResultatParse,
  options: OptionsFichesSeules | OptionsFichesSeulesCreation,
): Promise<RapportFichesSeules> {
  const creationDemandee = options.creerArticlesManquants === true;

  /**
   * SEUL point d'écriture d'article de tout ce mode, et il ne sait faire qu'une chose : CRÉER.
   * `update` / `upsert` / `updateMany` ne sont pas seulement inutilisés — ils n'existent pas dans
   * `ArticleStockCreationSeule`, donc aucune ligne d'ici ne peut les appeler.
   */
  const creerArticle = async (data: Record<string, unknown>): Promise<{ id: string; designation: string }> => {
    const cible = prisma.articleStock as Partial<ArticleStockCreationSeule>;
    if (typeof cible.create !== "function") {
      // Le type l'exige déjà (surcharge) ; ce contrôle protège les appels traversant un `as`.
      throw new Error(
        "ABANDON : --creer-articles-manquants a été demandé, mais le client fourni n'expose pas " +
          "`articleStock.create`. Rien n'a été écrit.",
      );
    }
    return cible.create({ data });
  };
  if (creationDemandee) {
    const cible = prisma.articleStock as Partial<ArticleStockCreationSeule>;
    if (typeof cible.create !== "function") {
      throw new Error(
        "ABANDON : --creer-articles-manquants a été demandé, mais le client fourni n'expose pas " +
          "`articleStock.create`. Rien n'a été écrit.",
      );
    }
  }

  // LECTURE du catalogue cible (aucune MISE À JOUR n'est exprimable sur ce client).
  const lireCatalogue = () =>
    prisma.articleStock.findMany({
      select: { id: true, designation: true, unite: true, prixUnitaireUSD: true },
      orderBy: [{ designation: "asc" }, { id: "asc" }],
    });

  const catalogue = await lireCatalogue();
  const correspondances = options.correspondances;

  // Plan SUR LE CATALOGUE TEL QU'IL EST. Lève si une correspondance arbitrée ne résout pas.
  const planInitial = planifierFichesSeules(res, catalogue, { correspondances });
  const { aCreer, sansValeurs } = articlesACreer(planInitial);

  // Les créations n'ont lieu qu'APRÈS tous les contrôles d'abandon : on raisonne d'abord sur le
  // catalogue PROJETÉ (identifiants factices, désignations réelles — l'empreinte ne dépend que des
  // désignations). Rien n'est créé pour un import qui va s'arrêter de toute façon.
  const clesCreees = creationDemandee ? new Set(aCreer.map((a) => a.cle)) : new Set<string>();
  const plan = creationDemandee
    ? planifierFichesSeules(res, projeterCatalogue(catalogue, aCreer), {
        correspondances,
        clesArticlesCrees: clesCreees,
      })
    : planInitial;

  const vide = {
    fichesSupprimees: [] as string[],
    fichesProtegees: [] as string[],
    fichesCreees: 0,
    ingredientsCrees: 0,
    fichesRefusees: plan.refusees,
    articlesManquants: plan.articlesManquants,
    articlesCrees: [] as ArticleCree[],
    articlesSansValeurs: creationDemandee ? sansValeurs : [],
    plan,
  };

  if (plan.creables.length === 0) {
    return {
      ...vide,
      statut: "ABANDON",
      message:
        `ABANDON : aucune des ${res.fiches.length} fiche(s) du classeur n'est créable sur ce catalogue — ` +
        `${plan.articlesManquants.length} article(s) distinct(s) y sont introuvables. Rien n'a été écrit, ` +
        "ni fiche, ni article (aucun article n'a été créé, et aucun article existant n'a pu être modifié : " +
        "ce mode ne sait pas le faire). " +
        (creationDemandee
          ? "Les articles restants n'ont AUCUNE valeur dans le classeur : rien n'est deviné. "
          : "Fais créer ou renommer les articles manquants (ou relance avec --creer-articles-manquants), puis relance."),
    };
  }

  const autorisees = new Set((options.supprimerNommement ?? []).map((n) => n.trim()));

  // Idempotence : même mécanique que l'import complet — clé naturelle (les noms du classeur)
  // rapprochée par désignation normalisée, DOUBLÉE de l'empreinte de contenu. Le périmètre est
  // ici celui des fiches CRÉABLES : une fiche refusée n'est pas attendue en base, et si une fiche
  // homonyme y existe déjà, elle n'est ni comptée, ni touchée, ni supprimée.
  const parCleNom = new Map(plan.creables.map((f) => [normaliserDesignation(f.nom), f]));
  const toutesFiches = await prisma.ficheTechnique.findMany({ select: SELECT_FICHE_SIGNATURE });
  const existantes = toutesFiches.filter((e) => parCleNom.has(normaliserDesignation(e.nom)));

  const conformes: FicheEnBase[] = [];
  const divergentes: FicheEnBase[] = [];
  for (const e of existantes) {
    const duClasseur = parCleNom.get(normaliserDesignation(e.nom));
    (duClasseur && empreinteBase(e) === empreinteFichesSeules(duClasseur, plan) ? conformes : divergentes).push(e);
  }
  const toutesLa = conformes.length === plan.creables.length && divergentes.length === 0;

  if (!options.force) {
    if (toutesLa) {
      return {
        ...vide,
        statut: "DEJA_FAIT",
        message:
          `Import déjà effectué : les ${conformes.length} fiche(s) créable(s) sont en base, à l'identique. ` +
          `Rien à faire (${plan.refusees.length} fiche(s) restent non importées, cf. articles manquants).`,
      };
    }
    if (existantes.length > 0) {
      return {
        ...vide,
        statut: "ABANDON",
        fichesProtegees: divergentes.map((f) => f.nom),
        message:
          `ABANDON : ${existantes.length} fiche(s) sur ${plan.creables.length} créable(s) portent déjà un nom du ` +
          `classeur, dont ${divergentes.length} dont le CONTENU DIFFÈRE` +
          (divergentes.length > 0 ? ` (${divergentes.map((f) => `« ${f.nom} »`).join(", ")})` : "") +
          ". Rien n'a été écrit. Ces fiches ont pu être saisies à la main : `FicheTechnique.nom` n'est pas " +
          "unique, et « Carbonara » ou « Bolognaise » sont des noms de carte ordinaires. Relance avec --force " +
          'pour remplacer les fiches CONFORMES, et --supprimer "<nom>" pour autoriser nommément la ' +
          "destruction de chaque fiche divergente.",
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

  const rapport: RapportFichesSeules = { ...vide, statut: "IMPORTE", message: "" };

  if (aSupprimer.length > 0) {
    const r = await supprimerEnOrdreDeDependance(prisma, aSupprimer, rapport.fichesSupprimees);
    if (!r.ok) return { ...rapport, statut: "ABANDON", fichesProtegees: r.protegees, message: r.message };
  }

  // ── Création CIBLÉE des articles absents (`--creer-articles-manquants`), et RIEN d'autre.
  //
  // Trois garanties, dans cet ordre :
  //   1. la liste `aCreer` sort du plan calculé sur le catalogue TEL QU'IL EST : elle ne contient,
  //      par construction, que des désignations qui n'y sont pas (correspondances déjà appliquées) ;
  //   2. seule `create` est appelée — `update` / `upsert` / `updateMany` n'existent pas dans le type ;
  //   3. un dernier contrôle relit le catalogue et REFUSE de créer une désignation qui y serait
  //      apparue entre-temps : mieux vaut abandonner que fabriquer un doublon.
  let planFinal = plan;
  if (creationDemandee && aCreer.length > 0) {
    const catalogueFrais = await lireCatalogue();
    const clesEnBase = new Set(catalogueFrais.map((a) => normaliserDesignation(a.designation)));
    const collisions = aCreer.filter((a) => clesEnBase.has(a.cle));
    if (collisions.length > 0) {
      return {
        ...rapport,
        statut: "ABANDON",
        message:
          `ABANDON : ${collisions.length} article(s) à créer existent MAINTENANT au catalogue ` +
          `(${collisions.map((a) => `« ${a.designation} »`).join(", ")}) alors qu'ils en étaient absents au ` +
          "début de cet import. Le catalogue a bougé sous nos pieds : on ne crée pas de doublon, on " +
          "s'arrête. Relance — aucun article n'a été créé, aucun n'a été modifié." +
          (rapport.fichesSupprimees.length > 0
            ? ` /!\\ ${rapport.fichesSupprimees.length} fiche(s) avaient déjà été supprimées et n'ont PAS été réécrites.`
            : ""),
      };
    }

    for (const a of aCreer) {
      const cree = await creerArticle({
        designation: a.designation,
        domaine: a.domaine,
        unite: a.unite,
        uniteParCarton: a.uniteParCarton,
        prixUnitaireUSD: a.prixUnitaireUSD,
        prixCartonUSD: a.prixCartonUSD,
        // Ni catégorie, ni fournisseur : le classeur n'en donne pas de fiable et on n'invente
        // rien. La Direction complétera — le rapport le dit.
      });
      rapport.articlesCrees.push({ ...a, id: cree.id });
    }

    // Re-planification sur le catalogue RÉEL : les identifiants factices de la projection ne
    // doivent JAMAIS atteindre `IngredientFiche.articleId`.
    planFinal = planifierFichesSeules(res, await lireCatalogue(), {
      correspondances,
      clesArticlesCrees: clesCreees,
    });

    // Garde-fou : la projection et la réalité doivent décider la même chose. Sinon on lève plutôt
    // que d'écrire des fiches qui ne sont pas celles que les contrôles d'abandon ont examinées.
    const memeListe =
      planFinal.creables.length === plan.creables.length &&
      planFinal.creables.every((f, i) => f === plan.creables[i]);
    if (!memeListe) {
      throw new Error(
        "Incohérence interne : après création des articles, la liste des fiches créables diffère de " +
          "celle qui a été projetée et contrôlée. Aucune fiche n'a été créée ; les articles créés, eux, " +
          `sont en base (${rapport.articlesCrees.length}) et ne gênent rien — relance.`,
      );
    }
    rapport.fichesRefusees = planFinal.refusees;
    rapport.articlesManquants = planFinal.articlesManquants;
    rapport.plan = planFinal;
  }

  // Création : sous-recettes d'abord, plats ensuite (ordre INCHANGÉ). Les ingrédients ne sont
  // insérés qu'une fois TOUTES les fiches créées : le lien de sous-recette est alors toujours
  // résoluble, quel que soit l'ordre.
  const idFiche = new Map<FicheParsee, string>();
  await prisma.$transaction(async (tx) => {
    for (const f of planFinal.creables) {
      const cree = await tx.ficheTechnique.create({
        data: {
          nom: f.nom,
          categorie: f.categorie,
          type: "PLAT",
          nbPortions: f.nbPortions !== null && f.nbPortions > 0 ? Math.round(f.nbPortions) : 1,
          tauxTVA: f.tauxTVA === null ? undefined : arrondir(f.tauxTVA, 4).toString(),
          prixVenteTTC: f.prixVenteTTC === null ? null : arrondir(f.prixVenteTTC, DECIMALES_PRIX).toString(),
          coefficientMargeCible:
            f.coefficientMargeCible === null ? null : arrondir(f.coefficientMargeCible, 4).toString(),
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
    rapport.fichesCreees = planFinal.creables.length;

    const creables = new Set(planFinal.creables);
    const aInserer = planFinal.lignes
      .filter((l) => creables.has(l.fiche))
      .map((l) => {
        // Invariant du mode : une fiche créable a TOUTES ses lignes rattachées. Si cet invariant
        // tombait, mieux vaut lever ici que créer une ligne muette (ni article, ni sous-fiche).
        if (l.rattachement.type === "AUCUN") {
          throw new Error(
            `Incohérence interne : la fiche « ${l.fiche.nom} » est déclarée créable alors que ` +
              `« ${l.ingredient.designation} » n'est rattaché à rien. Aucune fiche amputée n'est créée.`,
          );
        }
        return {
          ficheId: idFiche.get(l.fiche)!,
          articleId: l.rattachement.type === "ARTICLE" ? l.rattachement.article.id : null,
          sousFicheId: l.rattachement.type === "SOUS_RECETTE" ? idFiche.get(l.rattachement.fiche)! : null,
          unite: l.ingredient.unite,
          quantite: arrondir(l.ingredient.quantite ?? 0, DECIMALES_QUANTITE).toString(),
          ordre: l.ingredient.ordre,
        };
      });

    const TAILLE_LOT = 500;
    for (let i = 0; i < aInserer.length; i += TAILLE_LOT) {
      await tx.ingredientFiche.createMany({ data: aInserer.slice(i, i + TAILLE_LOT) });
    }
    rapport.ingredientsCrees = aInserer.length;
  }, { timeout: 120_000 });

  rapport.message =
    "Import terminé (FICHES SEULES — aucun article existant modifié" +
    (creationDemandee ? `, ${rapport.articlesCrees.length} article(s) CRÉÉ(S)` : ", catalogue NON modifié") +
    `) : ${rapport.fichesCreees} fiche(s) et ${rapport.ingredientsCrees} ingrédient(s) créés` +
    (rapport.fichesSupprimees.length > 0 ? `, ${rapport.fichesSupprimees.length} fiche(s) remplacée(s)` : "") +
    (planFinal.refusees.length > 0
      ? `. ${planFinal.refusees.length} fiche(s) NON importée(s) faute d'ingrédient rattachable (cf. liste).`
      : ".");
  return rapport;
}

// ─── Simulation QUI SE CONNECTE (transaction READ ONLY, vérifiée) ────────────

/** Client de simulation : rien d'autre qu'une transaction, dans laquelle on ne fait que LIRE. */
export type ClientLectureSeule = {
  $transaction<T>(fn: (tx: TxLectureSeule) => Promise<T>, options?: unknown): Promise<T>;
};

type TxLectureSeule = {
  $executeRawUnsafe(sql: string): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
  articleStock: { findMany(args: unknown): Promise<ArticleCatalogue[]> };
  ficheTechnique: { findMany(args: unknown): Promise<{ nom: string }[]> };
};

/**
 * Session DÉDIÉE : une connexion et une seule, sur laquelle l'état de session survit d'une
 * requête à l'autre. C'est ce que le repli de niveau 2 exige — et que `pg_backend_pid()` VÉRIFIE
 * plutôt que de le supposer (derrière un pooler en mode transaction, deux requêtes successives
 * peuvent atterrir sur deux sessions serveur différentes).
 */
export type SessionLectureSeule = {
  $executeRawUnsafe(sql: string): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
  articleStock: { findMany(args: unknown): Promise<ArticleCatalogue[]> };
  ficheTechnique: { findMany(args: unknown): Promise<{ nom: string }[]> };
};

/** Laquelle des deux protections de base de données a effectivement été obtenue, et vérifiée. */
export type ProtectionLecture = "TRANSACTION_READ_ONLY" | "SESSION_READ_ONLY";

export type SimulationFichesSeules = {
  /** Vrai UNIQUEMENT si PostgreSQL a confirmé `transaction_read_only = on`. Jamais supposé. */
  lectureSeuleVerifiee: boolean;
  /** Ce qui a réellement protégé la lecture — à AFFICHER, pour que le lecteur sache. */
  protection: ProtectionLecture;
  /** Pourquoi on a dû se replier en niveau 2, le cas échéant (message d'origine du refus). */
  motifRepli: string | null;
  /** PID du backend PostgreSQL, quand la protection de niveau 2 a dû le vérifier. */
  backendPid: string | null;
  nbArticlesCatalogue: number;
  /**
   * Plan RETENU pour les chiffres et les coûts : celui d'APRÈS création quand
   * `--creer-articles-manquants` est simulé, celui du catalogue tel quel sinon.
   */
  plan: PlanFichesSeules;
  /** Plan sur le catalogue TEL QU'IL EST : correspondances appliquées, aucun article créé. */
  planAvantCreation: PlanFichesSeules;
  /** La création a-t-elle été simulée ? Sinon, `plan` et `planAvantCreation` sont le même objet. */
  creationSimulee: boolean;
  /** Articles qui SERAIENT créés, valeurs comprises. Aucun n'est écrit : c'est une simulation. */
  articlesQuiSeraientCrees: ArticleACreer[];
  /** Articles introuvables qu'on REFUSERAIT de créer : le classeur ne leur donne aucune valeur. */
  articlesSansValeurs: ArticleManquant[];
  couts: SimulationFiche[];
  /** Fiches DÉJÀ en base portant le nom d'une fiche créable : l'import les refuserait sans --force. */
  homonymesEnBase: string[];
};

export type OptionsSimulation = {
  /**
   * Ouvre une SESSION DÉDIÉE (une seule connexion physique) pour le repli de niveau 2. Injectée :
   * `main()` en fabrique une sur l'URL fournie, le test d'intégration sur son Postgres jetable.
   * Absente, le repli n'est pas tenté — on préfère refuser plutôt que lire sans protection.
   */
  sessionDediee?: () => Promise<{ session: SessionLectureSeule; fermer: () => Promise<void> }>;
  /** Attente maximale pour OBTENIR la transaction interactive (P2028 = ce délai est trop court). */
  maxWaitMs?: number;
  /** Durée maximale de la transaction une fois obtenue. */
  timeoutMs?: number;
  /** Journal (par défaut `console.log`) : la simulation ANNONCE ce qu'elle tente et ce qu'elle obtient. */
  journal?: (message: string) => void;
  /** Table arbitrée par la Direction. Une correspondance qui ne résout pas ARRÊTE la simulation. */
  correspondances?: Correspondance[];
  /** Simule `--creer-articles-manquants` : le catalogue est PROJETÉ en mémoire, jamais écrit. */
  creerArticlesManquants?: boolean;
};

/** Délais généreux par défaut, surchargeables par variable d'environnement (cf. `main()`). */
export const SIMULATION_MAX_WAIT_MS = 30_000;
export const SIMULATION_TIMEOUT_MS = 120_000;

/** Sentinelle : provoque le ROLLBACK de la transaction de simulation. Jamais une vraie erreur. */
class FinDeSimulation extends Error {
  constructor() {
    super("Fin de simulation : ROLLBACK volontaire.");
    this.name = "FinDeSimulation";
  }
}

/** Ce que les deux niveaux de protection produisent en commun : la lecture du catalogue. */
type LectureCatalogue = { catalogue: ArticleCatalogue[]; fichesEnBase: { nom: string }[] };

const SELECT_CATALOGUE = {
  select: { id: true, designation: true, unite: true, prixUnitaireUSD: true },
  orderBy: [{ designation: "asc" }, { id: "asc" }],
} as const;

/**
 * Lit `SHOW transaction_read_only` et EXIGE « on ». Le seul point où l'on décide que la base nous
 * protège — ailleurs, on ne le suppose jamais.
 */
async function exigerDrapeauLectureSeule(
  q: { $queryRawUnsafe<T = unknown>(sql: string): Promise<T> },
  ou: string,
): Promise<void> {
  const drapeau = await q.$queryRawUnsafe<{ transaction_read_only: string }[]>("SHOW transaction_read_only");
  const valeur = drapeau?.[0]?.transaction_read_only;
  if (valeur !== "on") {
    throw new Error(
      `REFUS : ${ou} — « SHOW transaction_read_only » vaut « ${valeur ?? "(rien)"} » et non « on ». ` +
        "La base ne garantit donc PAS la lecture seule sur cette connexion, et on ne lit pas sans cette " +
        "garantie. Aucune dégradation silencieuse : la simulation s'arrête ici.",
    );
  }
}

/** PID du backend PostgreSQL qui a servi la requête — sert à prouver qu'on ne change pas de session. */
async function backendPid(q: { $queryRawUnsafe<T = unknown>(sql: string): Promise<T> }): Promise<string> {
  const r = await q.$queryRawUnsafe<{ pid: string }[]>("SELECT pg_backend_pid()::text AS pid");
  const pid = r?.[0]?.pid;
  if (pid === undefined || pid === null) {
    throw new Error("REFUS : impossible de lire `pg_backend_pid()` — sans lui, rien ne prouve que le SET " +
      "de session et les lectures ont eu lieu sur la MÊME connexion.");
  }
  return String(pid);
}

/**
 * NIVEAU 1 — transaction interactive : `BEGIN` (Prisma) + `SET TRANSACTION READ ONLY`, vérifié,
 * puis ROLLBACK. C'est la protection la plus forte : la transaction épingle la connexion, et
 * PostgreSQL refuse physiquement toute écriture pendant sa durée.
 */
async function lireEnTransactionLectureSeule(
  prisma: ClientLectureSeule,
  maxWaitMs: number,
  timeoutMs: number,
): Promise<LectureCatalogue> {
  let capture: LectureCatalogue | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await exigerDrapeauLectureSeule(tx, "transaction interactive");
        const catalogue = await tx.articleStock.findMany(SELECT_CATALOGUE);
        const fichesEnBase = await tx.ficheTechnique.findMany({ select: { nom: true } });
        // Re-vérifié APRÈS les lectures : le drapeau doit avoir tenu du début à la fin.
        await exigerDrapeauLectureSeule(tx, "transaction interactive (contrôle final)");
        capture = { catalogue, fichesEnBase };
        throw new FinDeSimulation(); // ROLLBACK : une simulation ne valide rien, même en lecture.
      },
      { maxWait: maxWaitMs, timeout: timeoutMs },
    );
  } catch (e) {
    if (!(e instanceof FinDeSimulation)) throw e;
  }
  if (capture === undefined) throw new Error("Transaction de simulation terminée sans lecture : rien n'est rapporté.");
  return capture;
}

/**
 * NIVEAU 2 — session dédiée : `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, vérifié par
 * `SHOW transaction_read_only`, sur UNE SEULE connexion physique.
 *
 * Le piège du pooler est traité de front : en mode transaction, un pooler peut router deux
 * requêtes successives vers deux sessions serveur différentes — le `SET` s'appliquerait alors à
 * une session, et les lectures à une autre, si bien que la vérification ne prouverait RIEN. On
 * relève donc `pg_backend_pid()` avant le `SET`, après la vérification, et après les lectures :
 * si le PID bouge, on REFUSE. Et le drapeau est revérifié à la fin, pour qu'il ait tenu de bout
 * en bout.
 */
async function lireEnSessionLectureSeule(session: SessionLectureSeule): Promise<LectureCatalogue & { pid: string }> {
  const pidAvant = await backendPid(session);
  await session.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  await exigerDrapeauLectureSeule(session, "session dédiée");

  const pidApresSet = await backendPid(session);
  if (pidApresSet !== pidAvant) {
    throw new Error(
      `REFUS : la connexion a CHANGÉ de session serveur entre deux requêtes (backend ${pidAvant} puis ` +
        `${pidApresSet}). C'est le comportement d'un pooler en mode transaction : le « SET SESSION » ne ` +
        "s'applique alors pas aux lectures, et sa vérification ne prouve rien. On refuse plutôt que de " +
        "lire sous une protection imaginaire. Utilise une connexion directe (ou le pooler en mode SESSION).",
    );
  }

  const catalogue = await session.articleStock.findMany(SELECT_CATALOGUE);
  const fichesEnBase = await session.ficheTechnique.findMany({ select: { nom: true } });

  // Contrôle final : même session, et drapeau toujours à « on ». Si l'un des deux a bougé, les
  // lectures qui précèdent n'étaient pas protégées — on ne publie pas un rapport là-dessus.
  const pidApresLectures = await backendPid(session);
  if (pidApresLectures !== pidAvant) {
    throw new Error(
      `REFUS : la connexion a changé de session serveur PENDANT les lectures (backend ${pidAvant} puis ` +
        `${pidApresLectures}) : la protection de lecture seule n'était donc pas continue. Rapport abandonné.`,
    );
  }
  await exigerDrapeauLectureSeule(session, "session dédiée (contrôle final)");

  return { catalogue, fichesEnBase, pid: pidAvant };
}

/**
 * Simulation QUI SE CONNECTE, en LECTURE SEULE — le `--dry-run` ordinaire n'ouvre aucune connexion
 * et ne peut donc rien dire d'un catalogue réel.
 *
 * DEUX PROTECTIONS, dans cet ordre, chacune ANNONCÉE :
 *   1. transaction interactive `READ ONLY` (délais généreux, surchargeables) ;
 *   2. si le pooler refuse la transaction interactive (P2028 « unable to start a transaction »),
 *      repli sur une SESSION DÉDIÉE en `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`,
 *      vérifiée par `SHOW transaction_read_only` ET par l'identité du backend PostgreSQL.
 *
 * Dans les deux cas, le drapeau doit valoir « on » AVANT la moindre lecture, sinon la simulation
 * REFUSE de tourner. Et dans les deux cas, le verrou de fond reste le TYPE `ClientFichesSeules`
 * (qui ne déclare que `findMany`) : la lecture seule côté base n'en est que la ceinture.
 */
export async function simulerFichesSeules(
  prisma: ClientLectureSeule,
  res: ResultatParse,
  options: OptionsSimulation = {},
): Promise<SimulationFichesSeules> {
  const journal = options.journal ?? ((m: string) => console.log(m));
  const maxWait = options.maxWaitMs ?? SIMULATION_MAX_WAIT_MS;
  const timeout = options.timeoutMs ?? SIMULATION_TIMEOUT_MS;

  let lecture: LectureCatalogue;
  let protection: ProtectionLecture;
  let motifRepli: string | null = null;
  let pid: string | null = null;

  try {
    journal(
      `Protection tentée (niveau 1) : TRANSACTION READ ONLY — attente max ${maxWait} ms, durée max ${timeout} ms.`,
    );
    lecture = await lireEnTransactionLectureSeule(prisma, maxWait, timeout);
    protection = "TRANSACTION_READ_ONLY";
    journal("Protection ACTIVE : transaction READ ONLY vérifiée (SHOW transaction_read_only = on), ROLLBACK final.");
  } catch (e) {
    // Un REFUS de vérification n'est PAS un motif de repli : le drapeau a répondu autre chose que
    // « on », c'est un « non » de la base, pas une indisponibilité. On ne contourne pas un refus.
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("REFUS :")) throw e;

    if (!options.sessionDediee) {
      throw new Error(
        `La transaction interactive en lecture seule a échoué (${message}) et aucune session dédiée n'est ` +
          "disponible pour le repli : simulation abandonnée. On ne lit pas sans garantie de lecture seule.",
      );
    }

    motifRepli = message;
    journal(
      `\n/!\\ Niveau 1 REFUSÉ par la base : ${message}\n` +
        "    (typiquement un pooler qui n'accorde pas de transaction interactive — P2028.)\n" +
        "Protection tentée (niveau 2) : SESSION DÉDIÉE en SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY.",
    );

    const { session, fermer } = await options.sessionDediee();
    try {
      const r = await lireEnSessionLectureSeule(session);
      lecture = { catalogue: r.catalogue, fichesEnBase: r.fichesEnBase };
      pid = r.pid;
      protection = "SESSION_READ_ONLY";
      journal(
        `Protection ACTIVE : session dédiée en lecture seule, vérifiée (SHOW transaction_read_only = on) ` +
          `et confinée à UNE SEULE session serveur (backend PostgreSQL ${pid}, identique de bout en bout).`,
      );
    } finally {
      // La session dédiée est JETÉE : son état « read only » ne doit contaminer aucune autre
      // connexion, et rien ne doit survivre à la simulation.
      await fermer();
    }
  }

  // Plan sur le catalogue TEL QU'IL EST : c'est lui qui dit combien de fiches sont créables
  // aujourd'hui, et quels articles manquent. Une correspondance morte LÈVE ici.
  const correspondances = options.correspondances;
  const planAvantCreation = planifierFichesSeules(res, lecture.catalogue, { correspondances });
  const { aCreer, sansValeurs } = articlesACreer(planAvantCreation);

  // Création SIMULÉE : le catalogue est PROJETÉ en mémoire (identifiants factices, préfixés
  // « (à créer) » pour qu'aucun lecteur ne les prenne pour de vrais identifiants). Rien n'est écrit.
  const creationSimulee = options.creerArticlesManquants === true;
  const plan = creationSimulee
    ? planifierFichesSeules(res, projeterCatalogue(lecture.catalogue, aCreer), {
        correspondances,
        clesArticlesCrees: new Set(aCreer.map((a) => a.cle)),
      })
    : planAvantCreation;

  const clesCreables = new Set(plan.creables.map((f) => normaliserDesignation(f.nom)));
  return {
    lectureSeuleVerifiee: true, // sinon on ne serait pas ici : toute autre issue lève
    protection,
    motifRepli,
    backendPid: pid,
    nbArticlesCatalogue: lecture.catalogue.length,
    plan,
    planAvantCreation,
    creationSimulee,
    articlesQuiSeraientCrees: creationSimulee ? aCreer : [],
    articlesSansValeurs: creationSimulee ? sansValeurs : [],
    couts: simulerCoutsFichesSeules(plan),
    homonymesEnBase: lecture.fichesEnBase
      .filter((f) => clesCreables.has(normaliserDesignation(f.nom)))
      .map((f) => f.nom),
  };
}

// ─── Rapport du mode fiches seules ───────────────────────────────────────────

export function formaterRapportFichesSeules(
  res: ResultatParse,
  plan: PlanFichesSeules,
  couts: SimulationFiche[],
  contexte: {
    nbArticlesCatalogue: number;
    homonymesEnBase?: string[];
    lectureSeuleVerifiee?: boolean;
    protection?: ProtectionLecture;
    motifRepli?: string | null;
    backendPid?: string | null;
    /** Plan sur le catalogue TEL QU'IL EST — pour dire ce que la création change vraiment. */
    planAvantCreation?: PlanFichesSeules;
    /** `--creer-articles-manquants` est-il demandé ? Change le sens des sections « articles ». */
    creationDemandee?: boolean;
    /** Articles qui SERAIENT créés (simulation). */
    articlesQuiSeraientCrees?: ArticleACreer[];
    /** Articles RÉELLEMENT créés (import). */
    articlesCrees?: ArticleCree[];
    /** Articles introuvables qu'on refuse de créer, faute de valeurs au classeur. */
    articlesSansValeurs?: ArticleManquant[];
  },
): string {
  const out: string[] = [];
  const trait = "═".repeat(78);

  out.push(`\n${trait}`);
  out.push("MODE FICHES SEULES — LE CATALOGUE `ArticleStock` N'EST PAS TOUCHÉ");
  out.push(trait);
  if (contexte.creationDemandee) {
    out.push("--creer-articles-manquants : les articles ABSENTS du catalogue sont CRÉÉS. Aucun article");
    out.push("EXISTANT n'est touché — ni prix, ni unité, ni quantité par carton, RIEN.");
  } else {
    out.push("Ni création, ni mise à jour, ni écrasement de prix : ce mode LIT le catalogue pour");
    out.push("rattacher les ingrédients, et n'y écrit rien.");
  }
  out.push("");
  out.push("GARANTIE DE FOND (active dans TOUS les cas, simulation comme import) : le verrou de");
  out.push("TYPE. Sans --creer-articles-manquants, `ClientFichesSeules` ne déclare que");
  out.push("`articleStock.findMany`. Avec le drapeau, `ArticleStockCreationSeule` ajoute `create` et");
  out.push("RIEN d'autre : ni update, ni upsert, ni updateMany — ces méthodes N'EXISTENT PAS dans le");
  out.push("type, donc aucune MISE À JOUR d'article n'est seulement exprimable. Et la transaction qui");
  out.push("crée les fiches n'a, elle, aucune propriété `articleStock`.");
  out.push("La lecture seule côté base, ci-dessous, n'en est que la CEINTURE.");
  if (contexte.lectureSeuleVerifiee !== undefined) {
    out.push("");
    if (!contexte.lectureSeuleVerifiee) {
      out.push("/!\\ Lecture seule NON vérifiée — ce rapport ne devrait pas exister.");
    } else if (contexte.protection === "SESSION_READ_ONLY") {
      out.push("CEINTURE ACTIVE : protection de niveau 2 — SESSION DÉDIÉE en lecture seule.");
      out.push("  `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, VÉRIFIÉ par");
      out.push("  « SHOW transaction_read_only » = on avant la moindre lecture, et confiné à UNE");
      out.push(`  SEULE session serveur${contexte.backendPid ? ` (backend PostgreSQL ${contexte.backendPid},` : " ("}`
        + " identique avant le SET, après la vérification et après les lectures).");
      out.push("  Ce contrôle du backend est ce qui empêche un pooler en mode transaction de router");
      out.push("  le SET et les lectures vers deux sessions différentes — auquel cas la vérification");
      out.push("  ne prouverait rien, et la simulation REFUSERAIT de tourner.");
      if (contexte.motifRepli) {
        out.push(`  Repli motivé par : ${contexte.motifRepli}`);
        out.push("  (la transaction interactive n'a pas été accordée — comportement de pooler, pas un refus");
        out.push("   de la base : la protection de niveau 2 la remplace, elle n'est pas une dégradation muette).");
      }
    } else {
      out.push("CEINTURE ACTIVE : protection de niveau 1 — TRANSACTION READ ONLY.");
      out.push("  `SET TRANSACTION READ ONLY` dans une transaction interactive, VÉRIFIÉ par");
      out.push("  « SHOW transaction_read_only » = on avant et après les lectures, puis ROLLBACK :");
      out.push("  PostgreSQL refusait physiquement toute écriture pendant cette lecture.");
    }
  }

  // « Créable » et non « créé » : ce bloc décrit le PÉRIMÈTRE calculé sur ce catalogue. Ce qui a
  // réellement été écrit (0 en cas d'abandon, 0 en simulation) est dit par le statut, plus bas —
  // deux choses différentes, jamais annoncées sous le même mot.
  out.push(`\n${"─".repeat(78)}\n1. PÉRIMÈTRE — CE QUI EST CRÉABLE SUR CE CATALOGUE\n${"─".repeat(78)}`);
  const nbSousRecettes = plan.creables.filter((f) => f.estSousRecette).length;
  out.push(`Articles au catalogue cible ........ ${contexte.nbArticlesCatalogue}`);
  out.push(`Fiches du classeur ................. ${res.fiches.length}  (${res.sousRecettes.length} sous-recettes + ${res.plats.length} plats)`);
  out.push(`Fiches CRÉABLES .................... ${plan.creables.length}  (${nbSousRecettes} sous-recette(s) + ${plan.creables.length - nbSousRecettes} plat(s))`);
  out.push(`Fiches REFUSÉES .................... ${plan.refusees.length}  (au moins un ingrédient non rattachable)`);
  if (contexte.planAvantCreation && contexte.planAvantCreation !== plan) {
    const avant = contexte.planAvantCreation;
    out.push(
      `  dont, AVANT création d'articles ... ${avant.creables.length} créable(s) / ${avant.refusees.length} refusée(s)` +
        ` → la création en fait passer ${plan.creables.length - avant.creables.length} de refusée(s) à créable(s).`,
    );
  }
  const creablesSet = new Set(plan.creables);
  const nbIngredients = plan.lignes.filter((l) => creablesSet.has(l.fiche)).length;
  out.push(`Ingrédients rattachés .............. ${nbIngredients}`);
  if (contexte.homonymesEnBase && contexte.homonymesEnBase.length > 0) {
    out.push("");
    out.push(`/!\\ ${contexte.homonymesEnBase.length} fiche(s) portent DÉJÀ un nom de fiche créable en base :`);
    out.push(`    ${contexte.homonymesEnBase.join(", ")}`);
    out.push("    L'import s'arrêtera sans --force (et --force reste protégé par l'empreinte de contenu).");
  }

  out.push(`\n${"─".repeat(78)}\n2. FICHES NON IMPORTÉES, ET POURQUOI\n${"─".repeat(78)}`);
  out.push("Une fiche à laquelle il manque UN ingrédient n'est PAS créée du tout. `IngredientFiche`");
  out.push("n'a aucun champ de libellé : une ligne sans article ni sous-fiche serait MUETTE à l'écran,");
  out.push("et la fiche afficherait un coût amputé avec l'apparence d'un coût complet. Mieux vaut pas");
  out.push("de fiche qu'une fiche mensongère.");
  if (plan.refusees.length === 0) out.push("  Aucune : toutes les fiches du classeur sont créables sur ce catalogue.");
  for (const f of plan.refusees) {
    out.push(`  • « ${f.nom} » (onglet ${f.onglet})`);
    if (f.articlesManquants.length > 0) {
      out.push(`      articles introuvables : ${f.articlesManquants.map((a) => `« ${a} »`).join(", ")}`);
    }
    if (f.sousRecettesRefusees.length > 0) {
      out.push(`      sous-recette(s) elles-mêmes non créées : ${f.sousRecettesRefusees.map((s) => `« ${s} »`).join(", ")}`);
    }
  }

  out.push(`\n${"─".repeat(78)}\n3. CORRESPONDANCES ARBITRÉES (scripts/correspondances-articles-fiches.json)\n${"─".repeat(78)}`);
  out.push("« Cette désignation du classeur EST cet article déjà au catalogue. » L'ARTICLE DU");
  out.push("CATALOGUE FAIT FOI : c'est SON unité et SON prix qui servent au calcul, jamais ceux du");
  out.push("classeur. Le conditionnement lu dans le nom (« 1KG », « 240g ») ne devient pas une donnée");
  out.push("d'article : il vit dans l'unité et la quantité de la ligne d'ingrédient. AUCUNE de ces");
  out.push("entrées n'écrit quoi que ce soit dans `ArticleStock`.");
  if (plan.correspondancesAppliquees.length === 0 && plan.correspondancesInutilisees.length === 0) {
    out.push("  Aucune correspondance chargée.");
  }
  out.push(`  Appliquées : ${plan.correspondancesAppliquees.length}`);
  for (const c of plan.correspondancesAppliquees) {
    out.push(
      `  • « ${c.entree.classeur} » → « ${c.article.designation} » — ${c.occurrences} ligne(s), ` +
        `${c.fiches.length} fiche(s)`,
    );
    out.push(`      motif : ${c.entree.motif}`);
    out.push(
      `      le catalogue fait foi : unité « ${c.article.unite ?? "—"} », prix ` +
        `${c.article.prixUnitaireUSD === null ? "— (ABSENT)" : `${c.article.prixUnitaireUSD.toString()} $`}` +
        ` ; recette consommée en ${c.unitesRecette.map((u) => `« ${u} »`).join(", ")}`,
    );
  }
  const inutilisees = plan.correspondancesInutilisees;
  if (inutilisees.length > 0) {
    out.push("");
    out.push(`  /!\\ ${inutilisees.length} correspondance(s) N'ONT SERVI À RIEN sur ce classeur :`);
    for (const c of inutilisees) {
      out.push(
        `      - « ${c.entree.classeur} » → « ${c.entree.catalogue} »` +
          (c.cibleAuCatalogue
            ? " (la cible existe bien au catalogue ; c'est la désignation de CLASSEUR qui ne figure"
              + " dans aucune fiche — ou elle se rattache déjà directement)"
            : " (et sa cible est ABSENTE du catalogue : entrée doublement suspecte, à relire)"),
      );
    }
    out.push("      Une table qui pourrit en silence finit par mentir : à relire, pas à ignorer.");
  }

  out.push(`\n${"─".repeat(78)}\n4. ARTICLES INTROUVABLES AU CATALOGUE (liste de travail pour la Direction)\n${"─".repeat(78)}`);
  out.push("Après application des correspondances. Dédoublonnés, DU PLUS UTILISÉ AU MOINS UTILISÉ.");
  out.push("Le « sosie » est une SUGGESTION à vérifier à l'œil, JAMAIS une décision : rien n'est");
  out.push("rattaché sur cette base.");
  out.push("/!\\ ATTENTION AUX CONDITIONNEMENTS. « Huile 1L régina » et « Huile 5L régina » ne");
  out.push("    diffèrent que d'un caractère et ne sont PAS le même article. Une ressemblance de");
  out.push("    lettres n'est pas une identité de produit : c'est un humain qui tranche.");
  if (plan.articlesManquants.length === 0) out.push("  Aucun : chaque ingrédient a trouvé son article au catalogue.");
  for (const a of plan.articlesManquants) {
    out.push(`  • « ${a.designation} » — ${a.occurrences} ligne(s), ${a.fiches.length} fiche(s) : ${a.fiches.join(", ")}`);
    if (a.sosie === null) {
      out.push("      sosie : aucun article du catalogue ne lui ressemble assez pour être proposé.");
    } else {
      out.push(
        `      SOSIE POSSIBLE (à vérifier) : « ${a.sosie.designation} » ` +
          `— ${Math.round(a.sosie.similarite * 100)} % de ressemblance, ${a.sosie.distance} caractère(s) d'écart`,
      );
      if (a.sosie.conditionnementDifferent) {
        out.push("      /!\\ LES CONDITIONNEMENTS LUS DIFFÈRENT : très probablement DEUX ARTICLES DISTINCTS.");
      }
    }
  }

  const crees = contexte.articlesCrees ?? [];
  const aCreer = contexte.articlesQuiSeraientCrees ?? [];
  const sansValeurs = contexte.articlesSansValeurs ?? [];
  if (contexte.creationDemandee) {
    const liste: ArticleACreer[] = crees.length > 0 ? crees : aCreer;
    const verbe = crees.length > 0 ? "CRÉÉS" : "QUI SERAIENT CRÉÉS";
    out.push(`\n${"─".repeat(78)}\n5. ARTICLES ${verbe} (--creer-articles-manquants)\n${"─".repeat(78)}`);
    out.push("CRÉATION SEULE. Aucun article EXISTANT n'est touché : ni prix, ni unité, ni quantité par");
    out.push("carton — la méthode `update` n'existe pas dans le type de client de ce mode.");
    out.push("Valeurs reprises TELLES QUELLES de la « Liste des articles » du classeur, arrondies à la");
    out.push("précision du schéma. SANS catégorie ni fournisseur : le classeur n'en donne pas de");
    out.push("fiable, on n'invente rien — LA DIRECTION DEVRA LES COMPLÉTER.");
    if (liste.length === 0) out.push("  Aucun : chaque ingrédient a trouvé son article au catalogue.");
    for (const a of liste) {
      out.push(`  • « ${a.designation} » — ${a.occurrences} ligne(s), ${a.fiches.length} fiche(s) : ${a.fiches.join(", ")}`);
      out.push(
        `      unité « ${a.unite ?? "—"} » | prix unitaire ${a.prixUnitaireUSD ?? "— (ABSENT)"} $ | ` +
          `qté/carton ${a.uniteParCarton ?? "—"} | prix carton ${a.prixCartonUSD ?? "—"} $ | domaine NOURRITURE`,
      );
      out.push(`      unité(s) de consommation en recette : ${a.unitesRecette.map((u) => `« ${u} »`).join(", ")}`);
      if (a.prixUnitaireUSD === null) {
        out.push("      /!\\ AUCUN PRIX au classeur : la fiche qui le consomme sortira en COÛT PARTIEL.");
      } else if (new Decimal(a.prixUnitaireUSD).lessThanOrEqualTo(0)) {
        out.push("      /!\\ PRIX À ZÉRO au classeur : le moteur le traite comme NON RENSEIGNÉ (coût partiel).");
      }
    }
    if (sansValeurs.length > 0) {
      out.push("");
      out.push(`  /!\\ ${sansValeurs.length} article(s) NON créé(s) : ils ne figurent pas non plus dans la`);
      out.push("      « Liste des articles » du classeur, donc aucune unité ni aucun prix n'est connu.");
      out.push("      On ne devine ni l'un ni l'autre. Leurs fiches restent refusées.");
      for (const a of sansValeurs) {
        out.push(`      - « ${a.designation} » — ${a.occurrences} ligne(s) : ${a.fiches.join(", ")}`);
      }
    }
  }

  out.push(`\n${"─".repeat(78)}\n6. UNITÉS QUI NE SE CONVERTIRONT PAS (coût PARTIEL annoncé)\n${"─".repeat(78)}`);
  out.push("L'unité d'ACHAT de l'article (celle du catalogue, qui fait foi) ne se convertit pas avec");
  out.push("l'unité de CONSOMMATION de la recette. Le moteur refusera de supposer un facteur : la");
  out.push("ligne sortira en `UNITE_INCONVERTIBLE` et la fiche en coût PARTIEL.");
  out.push("SIGNALÉ, JAMAIS CORRIGÉ : aucune conversion n'est devinée ici.");
  if (plan.unitesNonConvertibles.length === 0) {
    out.push("  Aucune : toutes les unités rattachées se convertissent.");
  }
  for (const u of plan.unitesNonConvertibles) {
    out.push(
      `  • « ${u.designationClasseur} » → article « ${u.articleCatalogue} » : recette en « ${u.uniteRecette} », ` +
        `catalogue en « ${u.uniteCatalogue ?? "(unité absente)"} »`,
    );
    out.push(
      `      ${u.occurrences} ligne(s), fiche(s) : ${u.fiches.join(", ")}` +
        (u.parCorrespondance ? " — RATTACHEMENT PAR CORRESPONDANCE ARBITRÉE" : "") +
        (u.articleCree ? " — article créé par --creer-articles-manquants" : ""),
    );
  }

  out.push(`\n${"─".repeat(78)}\n7. COÛT DES FICHES CRÉABLES (moteur src/lib/fiches/cout.ts, non modifié)\n${"─".repeat(78)}`);
  const incompletes = couts.filter((s) => s.incomplet);
  out.push(`  Coût COMPLET ................ ${couts.length - incompletes.length} / ${couts.length}`);
  out.push(`  Coût PARTIEL ou indéterminé . ${incompletes.length}`);
  out.push("  (Prix et unités lus DANS LE CATALOGUE CIBLE, pas dans le classeur : c'est bien le coût");
  out.push("   que l'application affichera après import.)");
  out.push("");
  for (const c of couts) {
    const parPortion = c.coutParPortion === null ? "indéterminé" : `${c.coutParPortion} $`;
    out.push(
      `  ${c.incomplet ? "PARTIEL" : "COMPLET"} — ${c.nom} : ${parPortion} / portion ` +
        `(${c.nbPortions} portion(s))`,
    );
    if (c.incomplet) out.push(`      motif : ${c.motifs.join(" | ") || "aucune ligne valorisée"}`);
  }

  if (plan.ambiguitesCatalogue.length > 0) {
    out.push(`\n${"─".repeat(78)}\n8. AMBIGUÏTÉS DU CATALOGUE CIBLE (rattachement au 1ᵉʳ, signalé)\n${"─".repeat(78)}`);
    out.push("  Deux articles du catalogue portent la même désignation normalisée. Le rattachement");
    out.push("  retient le premier dans un ordre déterministe (désignation puis id) — à dédoublonner");
    out.push("  côté application, sinon le coût dépend de celui des deux qui porte le bon prix.");
    for (const c of plan.ambiguitesCatalogue) out.push(`  • « ${c.cle} » ← ${c.designations.join(" / ")}`);
  }

  return out.join("\n");
}

// ─── Exécution ───────────────────────────────────────────────────────────────

/**
 * Entier positif lu dans l'environnement, sinon la valeur par défaut. Une valeur illisible est
 * SIGNALÉE plutôt qu'appliquée de travers : un délai à zéro relancerait le P2028 sans rien dire.
 */
function entierEnv(cle: string, defaut: number): number {
  const brut = process.env[cle];
  if (brut === undefined || brut.trim() === "") return defaut;
  const n = Number(brut);
  if (!Number.isFinite(n) || n <= 0) {
    console.log(`Note : ${cle}="${brut}" n'est pas un entier positif — valeur par défaut (${defaut} ms) conservée.`);
    return defaut;
  }
  return Math.round(n);
}

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
  const fichesSeules = args.includes("--fiches-seules");
  const creerArticlesManquants = args.includes("--creer-articles-manquants");
  const conserverPrixExistants = args.includes("--conserver-prix-existants");
  const supprimerNommement = lireSupprimer(args);

  // `--creer-articles-manquants` n'a de sens QUE dans le mode fiches seules : c'est lui qui refuse
  // toute mise à jour d'article. En import complet, le catalogue est déjà écrasé par le classeur —
  // laisser croire que ce drapeau y change quelque chose serait mensonger.
  if (creerArticlesManquants && !fichesSeules) {
    throw new Error(
      "--creer-articles-manquants ne s'utilise QU'AVEC --fiches-seules. En import complet, le catalogue " +
        "est de toute façon créé ET mis à jour depuis le classeur : ce drapeau n'y voudrait rien dire. " +
        "Rien n'a été lu, rien n'a été écrit.",
    );
  }

  // Une URL de base commence par « postgres… » : tout autre positionnel est un chemin de fichier.
  // Ainsi `--dry-run "/chemin/classeur.xlsx"` fonctionne sans jamais mentionner de base.
  const valeursDOptions = new Set(supprimerNommement);
  const positionnels = args.filter((a) => !a.startsWith("--") && !valeursDOptions.has(a));
  const urls = positionnels.filter((p) => /^postgres(ql)?:\/\//i.test(p));
  const chemins = positionnels.filter((p) => !/^postgres(ql)?:\/\//i.test(p));
  const databaseUrl = urls[0] ?? process.env.IMPORT_DATABASE_URL;
  const cheminFichier = chemins[0] ?? CHEMIN_PAR_DEFAUT;

  const suffixeCreation = creerArticlesManquants
    ? " + CRÉATION CIBLÉE des articles absents (aucun article existant modifié)"
    : "";
  const libelleMode = fichesSeules
    ? dryRun
      ? `FICHES SEULES — SIMULATION EN LECTURE SEULE (connexion réelle, transaction READ ONLY)${suffixeCreation}`
      : `FICHES SEULES — import des fiches${creerArticlesManquants ? "" : ", catalogue NON modifié"}${suffixeCreation}`
    : dryRun
      ? "MARCHE À VIDE (aucune écriture, aucune connexion)"
      : "IMPORT";
  console.log(`Fichier source : ${cheminFichier}`);
  console.log(`Mode : ${libelleMode}`);

  // La table de correspondances est lue et VALIDÉE avant tout le reste : une table illisible doit
  // arrêter le script avant la moindre connexion, et à plus forte raison avant la moindre écriture.
  const correspondances = fichesSeules ? chargerCorrespondances() : [];
  if (fichesSeules) {
    console.log(
      `Correspondances arbitrées chargées : ${correspondances.length} (${CHEMIN_CORRESPONDANCES}). ` +
        "Elles REDIRIGENT un rattachement ; elles n'écrivent rien dans le catalogue.",
    );
  }
  if (fichesSeules && conserverPrixExistants) {
    console.log(
      "Note : --conserver-prix-existants est SANS OBJET en mode fiches seules — aucun prix d'article " +
        "n'est écrit de toute façon.",
    );
  }

  const wb = XLSX.readFile(cheminFichier, { cellFormula: false, cellHTML: false, cellStyles: false, bookDeps: false });
  const res = analyserClasseur(wb);

  if (fichesSeules) {
    // Le rapport ci-dessous analyse LE CLASSEUR : ses sections sur les articles (écarts de prix,
    // prix invraisemblables, arrondis) décrivent ce que ferait l'import COMPLET. En mode fiches
    // seules, RIEN de tout cela n'est écrit — elles restent affichées parce qu'elles documentent
    // le classeur, pas parce qu'elles seraient appliquées.
    console.log(
      "\n/!\\ MODE FICHES SEULES : les sections « ÉCARTS DE PRIX », « PRIX INVRAISEMBLABLES » et\n" +
        "    « ARRONDIS » du rapport ci-dessous décrivent l'import COMPLET. Ici, AUCUN article n'est\n" +
        "    créé ni mis à jour : elles sont informatives sur le classeur, rien de plus.",
    );
  }
  console.log(formaterRapport(res, simulerCouts(res), simulerCouts(res, { arrondiSchema: true })));

  if (dryRun && !fichesSeules) return;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL manquante : passe-la en 1er argument (npx tsx scripts/import-fiches-plats.ts "postgresql://...") ' +
        "ou via IMPORT_DATABASE_URL, ou lance --dry-run. Aucun défaut vers la prod n'est fourni volontairement " +
        "(le .env du dépôt pointe la PRODUCTION)." +
        (fichesSeules && dryRun
          ? " La simulation --fiches-seules --dry-run SE CONNECTE (en lecture seule) : elle a besoin de l'URL, " +
            "et ne se rabat pas non plus sur le .env."
          : "")
    );
  }
  console.log(`\nBase cible : ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`); // mot de passe masqué

  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  if (fichesSeules) {
    try {
      if (dryRun) {
        const sim = await simulerFichesSeules(prisma as unknown as ClientLectureSeule, res, {
          correspondances,
          creerArticlesManquants,
          maxWaitMs: entierEnv("IMPORT_TX_MAX_WAIT_MS", SIMULATION_MAX_WAIT_MS),
          timeoutMs: entierEnv("IMPORT_TX_TIMEOUT_MS", SIMULATION_TIMEOUT_MS),
          // Repli de niveau 2 : une connexion physique UNIQUE (pool de taille 1, jamais recyclée
          // sur inactivité), pour que l'état « read only » de la session survive d'une requête à
          // l'autre. `pg_backend_pid()` le VÉRIFIE ensuite — le pool ne fait pas foi à lui seul.
          sessionDediee: async () => {
            const dedie = new PrismaClient({
              adapter: new PrismaPg({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 0 }),
            });
            return {
              session: dedie as unknown as SessionLectureSeule,
              fermer: () => dedie.$disconnect(),
            };
          },
        });
        console.log(
          formaterRapportFichesSeules(res, sim.plan, sim.couts, {
            nbArticlesCatalogue: sim.nbArticlesCatalogue,
            homonymesEnBase: sim.homonymesEnBase,
            lectureSeuleVerifiee: sim.lectureSeuleVerifiee,
            protection: sim.protection,
            motifRepli: sim.motifRepli,
            backendPid: sim.backendPid,
            planAvantCreation: sim.planAvantCreation,
            creationDemandee: sim.creationSimulee,
            articlesQuiSeraientCrees: sim.articlesQuiSeraientCrees,
            articlesSansValeurs: sim.articlesSansValeurs,
          }),
        );
        console.log(
          sim.protection === "TRANSACTION_READ_ONLY"
            ? "\nSIMULATION — transaction annulée (ROLLBACK). Aucune écriture, nulle part."
            : "\nSIMULATION — session dédiée en lecture seule, fermée et jetée. Aucune écriture, nulle part.",
        );
        return;
      }

      // Deux appels distincts, et non un objet d'options « à drapeau » : c'est la SURCHARGE de
      // `ecrireFichesSeules` qui impose le bon client. Sans le drapeau, le client fourni n'expose
      // même pas `articleStock.create`.
      const r = creerArticlesManquants
        ? await ecrireFichesSeules(prisma as unknown as ClientFichesSeulesCreation, res, {
            force,
            supprimerNommement,
            correspondances,
            creerArticlesManquants: true,
          })
        : await ecrireFichesSeules(prisma as unknown as ClientFichesSeules, res, {
            force,
            supprimerNommement,
            correspondances,
          });
      console.log(
        formaterRapportFichesSeules(res, r.plan, simulerCoutsFichesSeules(r.plan), {
          nbArticlesCatalogue: r.plan.nbArticlesCatalogue,
          creationDemandee: creerArticlesManquants,
          articlesCrees: r.articlesCrees,
          articlesSansValeurs: r.articlesSansValeurs,
        }),
      );
      console.log(`\n${r.statut} — ${r.message}`);
      if (r.fichesSupprimees.length > 0) {
        console.log(
          r.statut === "ABANDON"
            ? `\n/!\\ ${r.fichesSupprimees.length} fiche(s) SUPPRIMÉE(S) avant l'abandon, et NON réécrites : ${r.fichesSupprimees.join(", ")}`
            : `Fiches remplacées (contenu identique au classeur, ou destruction autorisée par --supprimer) : ${r.fichesSupprimees.join(", ")}`
        );
      }
      if (r.articlesCrees.length > 0) {
        console.log(
          `\n${r.articlesCrees.length} article(s) CRÉÉ(S) au catalogue (cf. §5) — SANS catégorie ni ` +
            "fournisseur, à compléter par la Direction. Aucun article existant n'a été modifié : ce mode " +
            "n'expose aucune méthode de mise à jour."
        );
      }
      if (r.fichesRefusees.length > 0) {
        console.log(
          `\n/!\\ ${r.fichesRefusees.length} fiche(s) NON importée(s) : il leur manque au moins un article au ` +
            "catalogue (cf. §2 et §4 ci-dessus). Aucune fiche amputée n'a été créée."
        );
      }
      if (r.statut === "ABANDON") process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  try {
    const r = await ecrireEnBase(prisma as unknown as ClientEcriture, res, { force, supprimerNommement, conserverPrixExistants });
    console.log(`\n${r.statut} — ${r.message}`);
    if (r.fichesSupprimees.length > 0) {
      // Un ABANDON peut survenir APRÈS des suppressions : elles ne sont alors pas « neutres »,
      // rien ne les a réécrites. On ne réutilise pas la phrase du cas nominal.
      console.log(
        r.statut === "ABANDON"
          ? `\n/!\\ ${r.fichesSupprimees.length} fiche(s) SUPPRIMÉE(S) avant l'abandon, et NON réécrites : ${r.fichesSupprimees.join(", ")}`
          : `Fiches remplacées (contenu identique au classeur, ou destruction autorisée par --supprimer) : ${r.fichesSupprimees.join(", ")}`
      );
    }
    if (r.ecrasementsPrix.length > 0) {
      console.log(
        `\n/!\\ ${r.ecrasementsPrix.length} valeur(s) d'article ÉCRASÉE(S) par le classeur. Si la Direction a corrigé ` +
          "un prix dans l'application, il vient d'être ramené à la valeur du classeur.\n" +
          "    Relance avec --conserver-prix-existants pour préserver les prix déjà en base."
      );
      for (const e of r.ecrasementsPrix) console.log(`    - ${e.designation} — ${e.champ} : ${e.avant} → ${e.apres}`);
    }
    if (r.prixConserves.length > 0) {
      console.log(
        `\n/!\\ ${r.prixConserves.length} prix conservé(s) (--conserver-prix-existants) alors que le classeur ` +
          "donne une AUTRE valeur : base et classeur divergent, à vérifier."
      );
      for (const p of r.prixConserves) {
        console.log(`    - ${p.designation} — ${p.champ} conservé (base ≠ classeur) : base ${p.base}, classeur ${p.classeur}`);
      }
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
