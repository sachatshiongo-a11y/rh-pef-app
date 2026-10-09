import Decimal from "decimal.js";
import { articlesProches } from "@/lib/article-proche";
import {
  contenanceCanonique, contenanceDansNom, estUniteComptage, facteur, facteurVersArticle, lireContenanceSaisie, normaliserUnite, uniteManquante,
  UNITES_CONTENANCE, type UniteArticle,
} from "@/lib/fiches/conversion";
import { rubriqueComparable } from "@/lib/fiches/famille-boisson";
import { distance, ressemblance } from "@/lib/classeur-ventes";
import { cleTexte, lireFeuillesXlsx, propre, type CelluleXlsx } from "@/lib/xlsx-leger";
import { ecrireSaisieNombre } from "@/lib/nombre";

// « Importer les fiches du bar (classeur Excel) » (Fiches techniques → Boissons, Direction) : la
// Direction dépose son classeur « Fiches techniques du bar » (une feuille par cocktail / mocktail) ;
// l'application en lit chaque fiche, PROPOSE la fiche visée et l'article de chaque ingrédient, et
// n'écrit que ce que la Direction a validé. Même doctrine que l'import des plats
// (scripts/import-fiches-plats.ts) : aucun rattachement deviné, aucune unité supposée, jamais un
// coût faux ni un zéro.
//
// Fonctions PURES, utilisables dans le navigateur (lecture du fichier, simulation) comme sur le
// serveur (validation, application) — la simulation affichée et l'écriture passent par le MÊME
// `planifierImportBar`, pour qu'on n'écrive jamais autre chose que ce qui a été montré.
//
// Lecture d'une feuille, telle que le classeur est construit (AUCUNE coordonnée en dur : la
// colonne de départ varie, A ou B, et les lignes bougent d'une feuille à l'autre) :
//  - la cellule « FICHE TECHNIQUE » donne la colonne des libellés ; les deux textes suivants de
//    cette colonne sont le TYPE (« Cocktail », « Mocktail », « Milkshake »…) puis le NOM ;
//  - « Nombre de verres », « Prix de vente TTC », « Taux TVA », « Type de verre utilisé » : la
//    valeur est la première cellule remplie à droite du libellé ;
//  - « Mode d'élaboration » : les lignes qui suivent (Shaker, Verre à mélange, Direct au verre,
//    Blender) ; le mode retenu est celui marqué d'un « x » à droite. Aucun « x » = mode inconnu ;
//  - le tableau commence à la ligne « Article | Unité | Unités nécessaires | Coût d'achat HT à
//    l'unité » (colonnes repérées par leur en-tête) et finit à « Total prix de revient HT ». Une
//    ligne sans article (formule XLOOKUP vide, quantité orpheline) est ignorée ;
//  - « Technique de prépar(a)tion » : toutes les lignes de texte qui suivent.
// Les valeurs calculées sont le résultat en cache des formules (ce qu'Excel affiche).

// ─── Types ───────────────────────────────────────────────────────────────────

export type LigneBarLue = {
  /** Article tel qu'écrit au classeur (espaces superflus retirés). */
  libelle: string;
  /** Unité de consommation telle qu'écrite (« cl », « unité », « ML »…), null si vide. */
  unite: string | null;
  /** Unités nécessaires ; null si la cellule n'est pas un nombre. */
  quantite: number | null;
  /** Coût d'achat HT à l'unité (USD, résultat de la formule) ; null si vide. */
  coutUnitaire: number | null;
};

export type FicheBarLue = {
  /** Nom de l'onglet (unique dans le classeur) : sert d'identifiant de la feuille. */
  feuille: string;
  /** Ligne de type (« Cocktail », « Mocktail »…), null si absente. */
  type: string | null;
  nom: string;
  verres: number | null;
  prixTTC: number | null;
  tauxTVA: number | null;
  /** Modes cochés d'un « x » (souvent aucun). */
  modes: string[];
  verre: string | null;
  lignes: LigneBarLue[];
  technique: string[];
};

export type FeuilleNonLue = { feuille: string; raison: string };
export type LectureBar = { ok: true; fiches: FicheBarLue[]; autres: FeuilleNonLue[] } | { ok: false; erreur: string };

export const REFUS_CLASSEUR_BAR =
  "Ce fichier n'est pas un classeur de fiches techniques du bar : aucune feuille ne porte « FICHE TECHNIQUE » suivie d'un tableau « Article | Unité | Unités nécessaires ».";

// ─── Lecture ─────────────────────────────────────────────────────────────────

const indexCol = (col: string) => [...col].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
/** Clé d'un libellé de structure : normalisé, sans « : » ni espaces de fin. */
const cleLibelle = (s: string) => cleTexte(s).replace(/[\s:.…]+$/, "");

type Rangee = CelluleXlsx[];
const cellule = (r: Rangee, col: string) => r.find((c) => c.col === col);
/** Première cellule à DROITE de `col` portant une valeur (texte ou nombre). */
const aDroite = (r: Rangee, col: string) =>
  r.filter((c) => indexCol(c.col) > indexCol(col) && (c.texte !== null || c.nombre !== null)).sort((a, b) => indexCol(a.col) - indexCol(b.col))[0];

const LIBELLES = {
  verres: (k: string) => k.startsWith("nombre de verres") || k.startsWith("nombre de portions"),
  prix: (k: string) => k.startsWith("prix de vente ttc"),
  tva: (k: string) => k.startsWith("taux tva"),
  mode: (k: string) => k.startsWith("mode d") && k.includes("elaboration"),
  verre: (k: string) => k.startsWith("type de verre"),
  total: (k: string) => k.startsWith("total prix de revient"),
  technique: (k: string) => k.startsWith("technique de prep"),
};
const estLibelleConnu = (k: string) => Object.values(LIBELLES).some((f) => f(k)) || k === "article";

function lireFeuille(feuille: string, rangees: Rangee[]): FicheBarLue | FeuilleNonLue {
  const r0 = rangees.findIndex((r) => r.some((c) => c.texte && cleLibelle(c.texte) === "fiche technique"));
  if (r0 < 0) return { feuille, raison: "pas une fiche technique (aucune cellule « FICHE TECHNIQUE »)" };
  const col = rangees[r0]!.find((c) => c.texte && cleLibelle(c.texte) === "fiche technique")!.col;
  const libelle = (r: Rangee) => cellule(r, col)?.texte ?? null;

  // Type puis nom : les textes de la colonne avant le premier libellé connu.
  const entete: string[] = [];
  let r = r0 + 1;
  for (; r < rangees.length; r++) {
    const t = libelle(rangees[r]!);
    if (!t) continue;
    if (estLibelleConnu(cleLibelle(t))) break;
    entete.push(t);
  }
  if (entete.length === 0) return { feuille, raison: "nom de la boisson introuvable sous « FICHE TECHNIQUE »" };
  const [type, nom] = entete.length >= 2 ? [entete[0]!, entete[1]!] : [null, entete[0]!];

  const fiche: FicheBarLue = { feuille, type, nom, verres: null, prixTTC: null, tauxTVA: null, modes: [], verre: null, lignes: [], technique: [] };
  let enTete: { article: string; unite?: string; quantite?: string; cout?: string } | null = null;
  let section: "mode" | "tableau" | "technique" | null = null;
  for (; r < rangees.length; r++) {
    const rangee = rangees[r]!;
    const t = libelle(rangee);
    const k = t ? cleLibelle(t) : "";
    if (section === "technique") {
      const texte = t ?? rangee.find((c) => c.texte)?.texte ?? null;
      if (texte) fiche.technique.push(texte);
      continue;
    }
    if (section === "tableau" && enTete) {
      if (LIBELLES.total(k)) { section = null; continue; }
      // Ligne « Total » absente ou renommée : la technique clôt le tableau, elle n'y entre jamais.
      if (LIBELLES.technique(k)) { section = "technique"; continue; }
      const article = cellule(rangee, enTete.article)?.texte ?? null;
      if (!article) continue; // formule sans article, quantité orpheline : pas une ligne
      const u = enTete.unite ? cellule(rangee, enTete.unite) : undefined;
      fiche.lignes.push({
        libelle: article,
        unite: u?.texte ?? null,
        quantite: enTete.quantite ? cellule(rangee, enTete.quantite)?.nombre ?? null : null,
        coutUnitaire: enTete.cout ? cellule(rangee, enTete.cout)?.nombre ?? null : null,
      });
      continue;
    }
    if (!t) continue;
    if (k === "article" && !enTete) {
      const col2 = (f: (k: string) => boolean) => rangee.find((c) => c.texte && f(cleLibelle(c.texte)))?.col;
      enTete = {
        article: col,
        unite: col2((x) => x === "unite" || x === "unites"),
        quantite: col2((x) => x.startsWith("unites necessaires") || x.startsWith("quantite")),
        cout: col2((x) => x.startsWith("cout d")),
      };
      section = "tableau";
      continue;
    }
    if (LIBELLES.technique(k)) { section = "technique"; continue; }
    if (LIBELLES.mode(k)) { section = "mode"; continue; }
    if (LIBELLES.verres(k)) { fiche.verres = aDroite(rangee, col)?.nombre ?? null; section = null; continue; }
    if (LIBELLES.prix(k)) { fiche.prixTTC = aDroite(rangee, col)?.nombre ?? null; section = null; continue; }
    if (LIBELLES.tva(k)) { fiche.tauxTVA = aDroite(rangee, col)?.nombre ?? null; section = null; continue; }
    if (LIBELLES.verre(k)) { fiche.verre = aDroite(rangee, col)?.texte ?? null; section = null; continue; }
    if (section === "mode") {
      // « Shaker : » + « x » à droite = mode retenu.
      if (aDroite(rangee, col)?.texte) fiche.modes.push(t.replace(/\s*:\s*$/, ""));
    }
  }
  if (!enTete) return { feuille, raison: "tableau « Article | Unité | Unités nécessaires » introuvable" };
  return fiche;
}

/** Lit le classeur (octets du .xlsx). Ne lève jamais : un refus revient en `{ ok: false, erreur }`. */
export async function lireClasseurBar(donnees: ArrayBuffer | Uint8Array): Promise<LectureBar> {
  const lu = await lireFeuillesXlsx(donnees, () => true);
  if (!lu.ok) return lu;
  const fiches: FicheBarLue[] = [];
  const autres: FeuilleNonLue[] = [];
  for (const [cle, rangees] of lu.feuilles) {
    // Nom de l'onglet débarrassé de ses espaces superflus (« Kir royal  ») : c'est l'identifiant de
    // la feuille ENTRE le navigateur et le serveur, qui le revalide sous cette forme.
    const r = lireFeuille(propre(lu.noms.get(cle) ?? cle), rangees);
    if ("raison" in r) autres.push(r);
    else fiches.push(r);
  }
  if (fiches.length === 0) return { ok: false, erreur: REFUS_CLASSEUR_BAR };
  return { ok: true, fiches, autres };
}

// ─── Correspondance des fiches ───────────────────────────────────────────────

/**
 * Mots d'un nom de boisson : accents retirés (« Piña » → « pina », « Daïquiri » → « daiquiri »),
 * casse ignorée, toute ponctuation (apostrophe, tiret, point) comptée comme une espace.
 */
export function motsBoisson(nom: string): string[] {
  return cleTexte(nom).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/** Famille comparable (« Cocktails » ≡ « cocktail ») ; chaîne vide = pas de famille. */
export const familleDe = (s: string | null | undefined) => rubriqueComparable(s);

/**
 * Forme canonique d'un nom, dans une famille :
 *  - famille « Mocktail » : le mot « virgin » est retiré (un mocktail est « virgin » par
 *    définition : « Virgin Piña Colada » en Mocktail EST la « Pina Colada » des mocktails) ;
 *  - ailleurs : « virgin » est ramené en fin de nom (« Virgin Mojito » ≡ « Mojito Virgin »).
 */
function formeCanonique(nom: string, famille: string): string[] {
  const mots = motsBoisson(nom);
  const sans = mots.filter((m) => m !== "virgin");
  if (famille === "mocktail") return sans;
  return sans.length < mots.length ? [...sans, "virgin"] : sans;
}

export type Correspondance = "exacte" | "orthographe";

/**
 * RÈGLE DE CORRESPONDANCE SÛRE d'une feuille du classeur avec une fiche existante. Les DEUX
 * conditions sont exigées :
 *
 *  1. MÊME FAMILLE : la ligne de type du classeur et la rubrique de la fiche, comparées sans
 *     accents, casse ni pluriel (« Cocktail » ≡ « Cocktails »). Une famille vide ne correspond à
 *     rien. « Pina Colada » existe en Cocktail ET en Mocktail : la famille départage.
 *  2. MÊME NOM, après normalisation (accents, casse, ponctuation, espaces ; « virgin » selon
 *     `formeCanonique`) :
 *     - « exacte » : mêmes mots, dans le même ordre ;
 *     - « orthographe » : même nombre de mots, tous identiques SAUF UN, qui diffère d'UNE seule
 *       lettre (ajout, retrait, remplacement ou inversion de deux lettres voisines), à condition
 *       que ce mot fasse au moins 6 lettres des deux côtés et ne contienne aucun chiffre
 *       (« Hawaiian » / « Hawaian », « Cosmopolitan » / « Cosmopolitain »). Jamais sur un mot
 *       court (« Gin » / « Gun »), jamais sur deux mots, jamais sur un nombre (« 12 ans » / « 18 ans »).
 *
 * Rend null si la correspondance n'est pas sûre. L'UNICITÉ est vérifiée à part
 * (`rattacherFiches`) : deux fiches candidates = pas sûr.
 */
export function correspondanceFiche(
  classeur: { nom: string; type: string | null },
  fiche: { nom: string; categorie: string | null },
): Correspondance | null {
  const famille = familleDe(classeur.type);
  if (!famille || familleDe(fiche.categorie) !== famille) return null;
  const a = formeCanonique(classeur.nom, famille);
  const b = formeCanonique(fiche.nom, famille);
  if (a.length === 0 || a.length !== b.length) return null;
  const differents = a.map((m, i) => [m, b[i]!] as const).filter(([x, y]) => x !== y);
  if (differents.length === 0) return "exacte";
  if (differents.length > 1) return null;
  const [x, y] = differents[0]!;
  if (/\d/.test(x) || /\d/.test(y) || Math.min(x.length, y.length) < 6) return null;
  return distance(x, y) === 1 ? "orthographe" : null;
}

/** Fiche existante, réduite à ce que l'import regarde. */
export type FicheExistanteBar = {
  id: string;
  nom: string;
  categorie: string | null;
  type: "PLAT" | "BAR";
  estSousRecette: boolean;
  actif: boolean;
  nbIngredients: number;
  recetteVide: boolean;
  prixVenteTTC: number | null;
  /** La fiche a déjà une photo : l'import n'en ajoute jamais par-dessus. */
  aPhoto?: boolean;
};

export type PropositionFiche = {
  feuille: string;
  /** Fiche proposée d'office (correspondance SÛRE et unique), sinon null. */
  ficheId: string | null;
  correspondance: Correspondance | null;
  /** Pourquoi rien n'est proposé d'office, quand une candidate existait. */
  doute: string | null;
  /** Fiches à montrer en tête de liste : JAMAIS choisies d'office. */
  suggestions: { id: string; libelle: string }[];
  /** Rubrique proposée si la Direction crée la fiche : l'orthographe en usage, sinon le type lu. */
  categorieProposee: string;
};

const libelleFiche = (f: FicheExistanteBar) => `${f.nom}${f.categorie ? ` (${f.categorie})` : ""}${f.actif ? "" : " — inactive"}`;

/**
 * Propose une fiche pour chaque feuille : seulement si la correspondance est sûre ET unique — une
 * fiche exacte l'emporte sur une fiche « à une lettre près » ; deux candidates du même rang, ou
 * deux feuilles qui visent la même fiche, et plus rien n'est proposé d'office.
 */
export function rattacherFiches(lues: FicheBarLue[], fiches: FicheExistanteBar[]): PropositionFiche[] {
  const bar = fiches.filter((f) => f.type === "BAR" && !f.estSousRecette);
  const brut = lues.map((l) => {
    const candidates = bar.filter((f) => f.actif).map((f) => ({ f, c: correspondanceFiche(l, f) })).filter((x) => x.c !== null);
    const exactes = candidates.filter((x) => x.c === "exacte");
    const retenues = exactes.length > 0 ? exactes : candidates;
    const unique = retenues.length === 1 ? retenues[0]! : null;
    const suggestions = new Map<string, string>();
    for (const x of candidates) suggestions.set(x.f.id, `${libelleFiche(x.f)} — même nom${x.c === "orthographe" ? " à une lettre près" : ""}`);
    for (const f of bar) {
      if (suggestions.has(f.id)) continue;
      const memeNom = motsBoisson(f.nom).join(" ") === motsBoisson(l.nom).join(" ");
      if (memeNom) suggestions.set(f.id, `${libelleFiche(f)} — même nom, autre rubrique`);
      else if (ressemblance(l.nom, f.nom).score >= 0.6) suggestions.set(f.id, `${libelleFiche(f)} — nom proche`);
    }
    const enUsage = bar.find((f) => f.categorie && familleDe(f.categorie) === familleDe(l.type))?.categorie;
    return {
      feuille: l.feuille,
      ficheId: unique?.f.id ?? null,
      correspondance: unique?.c ?? null,
      doute: unique ? null : retenues.length > 1 ? `${retenues.length} fiches répondent au même nom dans cette rubrique` : null,
      suggestions: [...suggestions].map(([id, libelle]) => ({ id, libelle })),
      categorieProposee: enUsage ?? propre(l.type ?? ""),
    };
  });
  // Deux feuilles pour une même fiche : aucune n'est rattachée d'office.
  const vises = new Map<string, number>();
  for (const p of brut) if (p.ficheId) vises.set(p.ficheId, (vises.get(p.ficheId) ?? 0) + 1);
  return brut.map((p) =>
    p.ficheId && vises.get(p.ficheId)! > 1
      ? { ...p, ficheId: null, correspondance: null, doute: "plusieurs feuilles du classeur visent cette fiche" }
      : p,
  );
}

// ─── Correspondance des ingrédients ──────────────────────────────────────────

/** Clé d'un libellé d'ingrédient : sans accents, casse ni espaces superflus. */
export const cleIngredient = (s: string) => cleTexte(s);

export type ArticleExistant = {
  id: string;
  designation: string;
  unite: string | null;
  prixUnitaireUSD: number | null;
  domaine: "NOURRITURE" | "BOISSON" | "AUTRE";
  /** Contenance d'une unité comptée à l'unité (texte pleine précision), null = inconnue. */
  contenance: string | null;
  contenanceUnite: string | null;
  /** Textes où chercher l'article en tapant (écran d'import) : jamais lus par le rapprochement. */
  nomCourt?: string | null;
  code?: string | null;
};

export type ValeursCreation = { designation: string; unite: string; prixUnitaireUSD: string | null; prixClasseur: number | null; uniteClasseur: string };

export type PropositionIngredient = {
  cle: string;
  libelle: string;
  /** Unités de consommation lues (normalisées), et feuilles qui l'emploient. */
  unites: string[];
  feuilles: string[];
  /** Article proposé d'office : mêmes mots ET même contenance, UN SEUL au catalogue. */
  articleId: string | null;
  doute: string | null;
  /** Articles à montrer en tête de liste, du plus ressemblant au moins : JAMAIS choisis d'office. */
  suggestions: string[];
  /** Ce que « Créer l'article » écrirait ; null si le classeur ne donne pas d'unité. */
  creation: ValeursCreation | null;
};

/**
 * Valeurs d'un article créé depuis le classeur. Le prix du classeur est « à l'unité de
 * consommation » (0,12 $ le cl) : on le ramène au LITRE ou au KILO, pour que les 4 décimales du
 * catalogue ne l'abîment pas (0,00138 $/g arrondi à 0,0014 = +1,4 % ; 1,38 $/kg = exact). Une
 * unité de comptage (« unité ») reste telle quelle. Prix absent ou nul au classeur = article SANS
 * prix (coût « — »), jamais un prix 0.
 */
export function valeursCreation(libelle: string, unite: string, prix: number | null): ValeursCreation {
  const u = normaliserUnite(unite);
  const cible = facteur(u, "l") !== null ? "l" : facteur(u, "kg") !== null ? "kg" : u;
  const f = facteur(u, cible) ?? new Decimal(1);
  // Un prix qui s'arrondit à 0 (ou nul au classeur) n'est pas « gratuit » : l'article est créé SANS prix.
  const prixCible = prix !== null ? new Decimal(prix).div(f).toDecimalPlaces(4) : null;
  return {
    designation: propre(libelle),
    unite: cible,
    prixUnitaireUSD: prixCible && prixCible.greaterThan(0) ? prixCible.toString() : null,
    prixClasseur: prix !== null && prix > 0 ? prix : null,
    uniteClasseur: u,
  };
}

// ─── Forme comparable d'un nom d'article ─────────────────────────────────────

/** Mots vides d'une désignation (« Jus d'Ananas », « Sirop de Grenadine »). */
const MOTS_VIDES_ARTICLE = new Set(["d", "de", "du", "des", "l", "la", "le", "les", "et", "a", "au", "aux", "en"]);
/** Toute mention de contenance, retirée des mots (elle est comparée à part, sous forme canonique). */
const CONTENANCE_DANS_TEXTE = /(^|[^a-z0-9./,])\d+(?:[.,]\d+)?\s*(?:ml|cl|ltr|lt|litres?|l|kg|gr|g)(?![a-z])/gi;

export type FormeArticle = { mots: string[]; contenance: string | null };

/**
 * Forme comparable d'un nom : mots sans accents, casse ni séparateurs (« - », « ' », espaces),
 * sans mots vides ni mention de contenance ; la contenance à part, canonique (1L = 1LTR = 100cl =
 * 1000ML ; 70CL = 700ML). « MONIN COCONUT FRUIT 1LTR » et « Monin Coconut Fruit-1L » ont la même forme.
 */
export function formeArticle(nom: string): FormeArticle {
  const sansAccents = nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return {
    mots: motsBoisson(sansAccents.replace(CONTENANCE_DANS_TEXTE, "$1 ")).filter((m) => !MOTS_VIDES_ARTICLE.has(m)),
    contenance: contenanceCanonique(contenanceDansNom(nom)),
  };
}

/** Correspondance SÛRE d'un libellé du classeur avec un article : mêmes mots ET même contenance (connue des deux côtés, ou absente des deux). */
export function memeArticle(a: FormeArticle, b: FormeArticle): boolean {
  return a.mots.length > 0 && a.mots.join(" ") === b.mots.join(" ") && a.contenance === b.contenance;
}

/** « blc » abrège « blanc », « liq » abrège « liqueur » : même initiale, lettres dans l'ordre, plus court. */
function abrege(court: string, long: string): boolean {
  if (court.length < 2 || court.length >= long.length || court[0] !== long[0] || /\d/.test(court + long)) return false;
  let i = 0;
  for (const c of long) if (c === court[i]) i++;
  return i === court.length;
}

/**
 * Ressemblance d'un libellé du classeur avec un article, pour CLASSER les « proches » (jamais pour
 * décider) : chaque mot du classeur vaut 1 s'il est dans l'article, 0,8 s'il en est une abréviation
 * (BLC ↔ blanc, LIQ ↔ liqueur), 0,7 à une lettre près (RUM ↔ rhum, BLUE ↔ bleu) ; total rapporté au
 * plus long des deux ; en dessous de 0,4 (moins de deux mots sur cinq), 0 : une contenance ou un
 * mot commun (« Monin », « blanc ») ne rapproche rien à lui seul. Au-dessus, +0,25 si les
 * contenances sont égales, −0,25 si elles diffèrent.
 */
export function scoreProche(a: FormeArticle, b: FormeArticle): number {
  if (a.mots.length === 0 || b.mots.length === 0) return 0;
  const libres = [...b.mots];
  let total = 0;
  for (const m of a.mots) {
    let meilleur = 0, k = -1;
    libres.forEach((x, i) => {
      const v = x === m ? 1 : abrege(m, x) || abrege(x, m) ? 0.8
        : !/\d/.test(m + x) && Math.min(m.length, x.length) >= 3 && distance(m, x) === 1 ? 0.7 : 0;
      if (v > meilleur) { meilleur = v; k = i; }
    });
    if (k >= 0) { total += meilleur; libres.splice(k, 1); }
  }
  const mots = total / Math.max(a.mots.length, b.mots.length);
  if (mots < SEUIL_PROCHE_ARTICLE) return 0;
  const bonus = a.contenance && b.contenance ? (a.contenance === b.contenance ? 0.25 : -0.25) : 0;
  return mots + bonus;
}

/** Au-delà, un article est montré parmi les « proches » (8 au plus, du plus ressemblant au moins). */
export const SEUIL_PROCHE_ARTICLE = 0.4;

/**
 * Propose un article pour chaque libellé distinct du classeur (un même libellé n'est demandé
 * qu'UNE fois, quel que soit le nombre de fiches qui l'emploient). Correspondance SÛRE = mêmes
 * mots ET même contenance (`memeArticle`) et un SEUL article actif ainsi fait. Une abréviation
 * (« BACARDI BLC 1L » / « Bacardi blanc-1l ») ou une lettre d'écart n'est JAMAIS sûre : pour les
 * spiritueux, deux orthographes voisines sont souvent deux articles (décision de la Direction) —
 * elles font seulement remonter l'article en tête des « proches ».
 */
export function rattacherIngredients(lues: FicheBarLue[], articles: ArticleExistant[]): PropositionIngredient[] {
  const parCle = new Map<string, { libelle: string; unites: Set<string>; feuilles: Set<string>; premiere: LigneBarLue }>();
  for (const f of lues) {
    for (const l of f.lignes) {
      const k = cleIngredient(l.libelle);
      const e = parCle.get(k) ?? { libelle: l.libelle, unites: new Set<string>(), feuilles: new Set<string>(), premiere: l };
      if (l.unite && !uniteManquante(l.unite)) e.unites.add(normaliserUnite(l.unite));
      e.feuilles.add(f.feuille);
      if ((e.premiere.coutUnitaire ?? 0) <= 0 && (l.coutUnitaire ?? 0) > 0 && l.unite) e.premiere = l;
      parCle.set(k, e);
    }
  }
  const formes = articles.map((a) => ({ a, f: formeArticle(a.designation) }));
  return [...parCle].map(([cle, e]) => {
    const forme = formeArticle(e.libelle);
    const memes = formes.filter((x) => memeArticle(forme, x.f)).map((x) => x.a);
    const proches = formes
      .filter((x) => !memes.includes(x.a))
      .map((x) => ({ a: x.a, s: scoreProche(forme, x.f) }))
      .filter((x) => x.s >= SEUIL_PROCHE_ARTICLE)
      .sort((x, y) => y.s - x.s || x.a.designation.localeCompare(y.a.designation, "fr"))
      .slice(0, 8);
    const unite = e.premiere.unite && !uniteManquante(e.premiere.unite) ? e.premiere.unite : [...e.unites][0];
    return {
      cle,
      libelle: e.libelle,
      unites: [...e.unites],
      feuilles: [...e.feuilles],
      articleId: memes.length === 1 ? memes[0]!.id : null,
      doute: memes.length > 1 ? `${memes.length} articles du catalogue ont ce nom et cette contenance` : null,
      // + les articles proches selon la règle anti-doublon du catalogue (lib/article-proche.ts, 2026-10-09) :
      // un « Créer l'article » choisi malgré eux est un « Créer quand même » explicite.
      suggestions: [...new Set([...(memes.length > 1 ? memes.map((a) => a.id) : []), ...proches.map((x) => x.a.id), ...articlesProches(e.libelle, articles.filter((a) => !memes.includes(a))).map((x) => x.article.id)])].slice(0, 8),
      creation: unite ? valeursCreation(e.libelle, unite, e.premiere.unite === unite ? e.premiere.coutUnitaire : null) : null,
    };
  });
}

/**
 * L'unité de consommation se ramène-t-elle à l'unité de stock de l'article ? Par la porte UNIQUE
 * du moteur (`facteurVersArticle`, src/lib/fiches/conversion.ts) : directe, contenance d'un
 * article compté à l'unité, puis emballage. Un test d'accord confronte le moteur de coût.
 */
export function uniteConvertible(uniteConso: string, article: UniteArticle): boolean {
  if (uniteManquante(uniteConso)) return false;
  return facteurVersArticle(uniteConso, article) !== null;
}

// ─── Contenance à renseigner (article compté à l'unité, sans contenance) ─────

/** Unités de stock proposées quand l'article du catalogue n'en a AUCUNE (« Jus d'Ananas-Ceres-1L »). */
export const UNITES_STOCK_COMPTAGE = ["Bouteille", "Canette", "Brique", "Pièce", "Unité", "Boîte", "Paquet", "Flacon", "Pot", "Sachet"] as const;

/** Contenance saisie (ou confirmée) par la Direction pour UN article, dans l'import. */
export type ContenanceChoisie = { quantite: string; unite: string; /** unité de stock, seulement si l'article n'en a pas */ uniteStock: string | null };

/**
 * L'article a-t-il besoin d'une contenance pour cette consommation ? Oui s'il se compte à l'unité
 * (ou n'a pas d'unité du tout), n'a pas de contenance, et que la consommation ne s'y convertit
 * pas déjà directement (« Bouteille » consommée en « Bouteille »).
 */
export function contenanceRequise(article: ArticleExistant, unitesConso: string | null | readonly (string | null)[]): boolean {
  if (article.contenance !== null) return false;
  const u = article.unite ?? "";
  if (!uniteManquante(u) && !estUniteComptage(u)) return false;
  // Une contenance ne sert qu'à une consommation en VOLUME ou en MASSE (cl, g…) : « unité » ou
  // « pièce » sur une Bouteille reste inconvertible, sans champ inutile. Un libellé peut être
  // consommé en plusieurs unités (« Bouteille » ici, « cl » là) : il en faut une dès qu'UNE de ses
  // grandeurs ne se convertit pas directement.
  const unites = (Array.isArray(unitesConso) ? unitesConso : [unitesConso]).filter((x): x is string => !!x && !uniteManquante(x));
  const grandeurs = unites.filter((x) => facteur(x, "ml") !== null || facteur(x, "g") !== null);
  if (grandeurs.length === 0) return false;
  if (!uniteManquante(u) && grandeurs.every((x) => facteur(x, u) !== null)) return false;
  return true;
}

/**
 * Article du catalogue que vise un choix d'ingrédient : « art:<id> », ou « Créer » qui RÉUTILISE
 * l'article portant déjà ce nom et cette contenance (un seul) — la même règle que le plan.
 */
export function articleVise(libelle: string, cible: string, articles: ArticleExistant[]): ArticleExistant | null {
  if (cible.startsWith("art:")) return articles.find((a) => a.id === cible.slice(4)) ?? null;
  if (cible !== "creer") return null;
  const f = formeArticle(libelle);
  const memes = articles.filter((a) => memeArticle(f, formeArticle(a.designation)));
  return memes.length === 1 ? memes[0]! : null;
}

/** Proposition pré-remplie : la contenance LUE dans la désignation (« -70cl »), sinon vide (à taper). */
export function contenanceProposee(article: ArticleExistant): ContenanceChoisie & { lue: boolean } {
  const c = contenanceDansNom(article.designation);
  return {
    quantite: c ? ecrireSaisieNombre(Number(c.quantite)) : "", // à la virgule : relu par la saisie française
    unite: c ? c.unite : "cl",
    // Article SANS unité : l'unité de stock n'est JAMAIS supposée (son prix est « 2,86 $ par ? ») —
    // la Direction la choisit, la ligne reste bloquée d'ici là.
    uniteStock: null,
    lue: c !== null,
  };
}

/**
 * Pourquoi une contenance choisie n'est pas utilisable (null : elle l'est). UNE règle, celle du
 * catalogue (`lireContenanceSaisie` : nombre décimal > 0, 3 décimales au plus, unité de
 * contenance) — jamais l'erreur SQL du CHECK ni un arrondi silencieux — plus l'unité de stock,
 * exigée quand l'article du catalogue n'en a pas.
 */
export function erreurContenanceChoisie(c: ContenanceChoisie | undefined, article: ArticleExistant): string | null {
  if (!c || (!String(c.quantite).trim() && !uniteManquante(article.unite))) return `1 ${article.unite} = combien ?`;
  if (uniteManquante(article.unite) && !(UNITES_STOCK_COMPTAGE as readonly string[]).includes(c.uniteStock ?? "")) {
    return `article sans unité : choisir son unité de stock (son prix ${article.prixUnitaireUSD === null ? "est inconnu" : `de ${article.prixUnitaireUSD} $ est « par ? »`})`;
  }
  try {
    const lu = lireContenanceSaisie(c.quantite, c.unite);
    return lu.contenance === null ? `1 ${article.unite || c.uniteStock} = combien ?` : null;
  } catch (e) {
    return e instanceof Error ? e.message : "contenance illisible";
  }
}

/** Une contenance choisie est-elle utilisable ? (cf. `erreurContenanceChoisie`) */
export function contenanceValideChoisie(c: ContenanceChoisie | undefined, article: ArticleExistant): c is ContenanceChoisie {
  return erreurContenanceChoisie(c, article) === null;
}

// ─── Plan (PUR : la simulation affichée ET l'écriture) ───────────────────────

/** « fiche:<id> » | « creer » | « ignorer » | « » (à décider). */
export type CibleFiche = string;
/** « art:<id> » | « creer » | « ignorer » | « » (à décider). */
export type CibleIngredient = string;

export type ChoixFiche = { cible: CibleFiche; categorie: string; remplacer: boolean };
export type ChoixIngredient = { cible: CibleIngredient; domaine: "NOURRITURE" | "BOISSON" | "AUTRE" };
export type ChoixImportBar = {
  fiches: Record<string, ChoixFiche>;
  ingredients: Record<string, ChoixIngredient>;
  /**
   * Contenances saisies ou confirmées, PAR ARTICLE du catalogue (id) : deux libellés qui visent la
   * même bouteille partagent la même contenance. Ne sert que si l'article n'en a pas encore.
   */
  contenances: Record<string, ContenanceChoisie>;
};

export type StatutLigne = "OK" | "IGNOREE" | "A_DECIDER" | "BLOQUEE";
export type LignePlan = {
  libelle: string;
  cle: string;
  quantite: number | null;
  unite: string | null;
  statut: StatutLigne;
  motif: string | null;
  /**
   * Article visé : existant (id) ou à créer (id null). `contenanceAEcrire` : contenance (et unité
   * de stock si l'article n'en avait pas) que l'import écrira sur l'article — jamais sur un
   * article qui a déjà une contenance.
   */
  article: { id: string | null; designation: string; unite: string; contenanceAEcrire: ContenanceChoisie | null } | null;
};

export type StatutFiche = "A_DECIDER" | "IGNOREE" | "BLOQUEE" | "DEJA_REMPLIE" | "PRETE";
export type FichePlan = {
  feuille: string;
  nom: string;
  statut: StatutFiche;
  raisons: string[];
  /** Fiche visée : existante (id) ou à créer (id null). */
  cible: { id: string | null; nom: string; categorie: string | null; nbIngredients: number; recetteVide: boolean; prixVenteTTC: number | null } | null;
  remplacer: boolean;
  lignes: LignePlan[];
  nbPortions: number | null;
  recette: string | null;
};

/** Clé d'unicité d'une fiche créée : même nom normalisé dans la même famille. */
export const cleFicheCreee = (nom: string, categorie: string | null) => `${motsBoisson(nom).join(" ")}|${familleDe(categorie)}`;

/** Texte de la recette : verre et mode en tête, puis la technique, puis ce qui n'a pas été repris. */
export function recetteDe(f: FicheBarLue, ignores: LignePlan[]): string | null {
  const tete = [f.verre ? `Verre : ${f.verre}` : null, f.modes.length ? `Mode : ${f.modes.join(", ")}` : null].filter(Boolean) as string[];
  const blocs = [tete.join("\n"), f.technique.join("\n")];
  if (ignores.length) {
    blocs.push(`Non repris du classeur : ${ignores.map((l) => `${l.libelle} (${l.quantite ?? "—"} ${l.unite ?? ""})`.replace(/\s+\)/, ")")).join(" ; ")}.`);
  }
  const texte = blocs.filter((b) => b.trim()).join("\n\n");
  return texte || null;
}

/**
 * Décide, SANS RIEN ÉCRIRE, ce que l'application ferait de chaque feuille avec ces choix-là.
 *  - une fiche dont UNE ligne est à décider ou bloquée n'est PAS écrite (une ligne sans article
 *    serait muette à l'écran et le coût paraîtrait complet) ; « Ignorer la ligne » est un choix
 *    explicite : la ligne est alors écrite dans la recette (« Non repris du classeur »), jamais perdue ;
 *  - une unité qui ne se convertit pas vers l'unité de l'article choisi BLOQUE la ligne (jamais
 *    un coût faux, jamais un zéro) ;
 *  - « Créer » (fiche ou article) réutilise ce qui existe déjà sous le même nom : relancer
 *    l'import ne crée aucun doublon ;
 *  - une fiche qui a déjà des ingrédients n'est remplacée que si la case « Remplacer » est cochée.
 */
export function planifierImportBar(
  lues: FicheBarLue[],
  choix: ChoixImportBar,
  articles: ArticleExistant[],
  fiches: FicheExistanteBar[],
  propositions: PropositionIngredient[],
): FichePlan[] {
  const parId = new Map(articles.map((a) => [a.id, a]));
  const formes = articles.map((a) => ({ a, f: formeArticle(a.designation) }));
  const propParCle = new Map(propositions.map((p) => [p.cle, p]));
  const ficheParId = new Map(fiches.map((f) => [f.id, f]));
  const bar = fiches.filter((f) => f.type === "BAR" && !f.estSousRecette);

  const plans = lues.map((l): FichePlan => {
    const c = choix.fiches[l.feuille] ?? { cible: "", categorie: "", remplacer: false };
    const base: FichePlan = { feuille: l.feuille, nom: l.nom, statut: "A_DECIDER", raisons: [], cible: null, remplacer: c.remplacer, lignes: [], nbPortions: null, recette: null };
    if (c.cible === "ignorer") return { ...base, statut: "IGNOREE" };
    if (c.cible === "") return { ...base, raisons: ["choisir la fiche visée"] };

    const raisons: string[] = [];
    let cible: FichePlan["cible"];
    if (c.cible.startsWith("fiche:")) {
      const f = ficheParId.get(c.cible.slice(6));
      if (!f || f.type !== "BAR" || f.estSousRecette) return { ...base, statut: "BLOQUEE", raisons: ["la fiche choisie n'existe plus ou n'est pas une fiche Bar"] };
      cible = { id: f.id, nom: f.nom, categorie: f.categorie, nbIngredients: f.nbIngredients, recetteVide: f.recetteVide, prixVenteTTC: f.prixVenteTTC };
    } else if (c.cible === "creer") {
      const categorie = propre(c.categorie) || propre(l.type ?? "");
      if (!categorie) return { ...base, statut: "BLOQUEE", raisons: ["préciser la rubrique de la fiche à créer"] };
      const deja = bar.find((f) => cleFicheCreee(f.nom, f.categorie) === cleFicheCreee(l.nom, categorie));
      if (deja && !deja.actif) {
        return { ...base, statut: "BLOQUEE", raisons: [`une fiche INACTIVE porte déjà ce nom (« ${deja.nom} », ${deja.categorie ?? "sans rubrique"}) : la choisir dans la liste, ou la réactiver`] };
      }
      cible = deja
        ? { id: deja.id, nom: deja.nom, categorie: deja.categorie, nbIngredients: deja.nbIngredients, recetteVide: deja.recetteVide, prixVenteTTC: deja.prixVenteTTC }
        : { id: null, nom: propre(l.nom), categorie, nbIngredients: 0, recetteVide: true, prixVenteTTC: l.prixTTC !== null && l.prixTTC > 0 ? Math.round(l.prixTTC * 100) / 100 : null };
    } else {
      return { ...base, statut: "BLOQUEE", raisons: ["choix de fiche illisible"] };
    }

    const lignes: LignePlan[] = l.lignes.map((ln) => {
      const cle = cleIngredient(ln.libelle);
      const ci = choix.ingredients[cle] ?? { cible: "", domaine: "BOISSON" };
      const unite = ln.unite && !uniteManquante(ln.unite) ? normaliserUnite(ln.unite) : null;
      const b: LignePlan = { libelle: ln.libelle, cle, quantite: ln.quantite, unite, statut: "OK", motif: null, article: null };
      if (ci.cible === "ignorer") return { ...b, statut: "IGNOREE", motif: "ignorée à la demande" };
      if (ci.cible === "") return { ...b, statut: "A_DECIDER", motif: "choisir l'article" };
      let article: LignePlan["article"] = null;
      let existant: ArticleExistant | null = null;
      if (ci.cible.startsWith("art:")) {
        existant = parId.get(ci.cible.slice(4)) ?? null;
        if (!existant) return { ...b, statut: "BLOQUEE", motif: "l'article choisi n'existe plus" };
      } else if (ci.cible === "creer") {
        // « Créer » réutilise l'article qui a DÉJÀ ce nom et cette contenance (relancer ne double rien).
        const forme = formeArticle(ln.libelle);
        const memes = formes.filter((x) => memeArticle(forme, x.f)).map((x) => x.a);
        if (memes.length > 1) return { ...b, statut: "BLOQUEE", motif: "plusieurs articles portent déjà ce nom : choisir lequel" };
        const creation = propParCle.get(cle)?.creation ?? null;
        if (memes.length === 1) existant = memes[0]!;
        else if (creation) article = { id: null, designation: creation.designation, unite: creation.unite, contenanceAEcrire: null };
        else return { ...b, statut: "BLOQUEE", motif: "le classeur ne donne pas d'unité : impossible de créer l'article" };
      } else {
        return { ...b, statut: "BLOQUEE", motif: "choix d'article illisible" };
      }
      // Article existant compté à l'unité sans contenance : la contenance saisie (ou lue dans son
      // nom et confirmée) sera écrite sur l'article ; tant qu'elle manque, la ligne est bloquée.
      let effectif: UniteArticle | null = null;
      if (existant) {
        const aEcrire = contenanceRequise(existant, unite) ? choix.contenances?.[existant.id] : undefined;
        article = { id: existant.id, designation: existant.designation, unite: existant.unite ?? "", contenanceAEcrire: null };
        if (contenanceRequise(existant, unite)) {
          const erreur = erreurContenanceChoisie(aEcrire, existant);
          if (erreur !== null || !aEcrire) {
            return { ...b, article, statut: "BLOQUEE", motif: `contenance de « ${existant.designation} » à renseigner (${erreur})` };
          }
          // Forme canonique de la règle unique (« 0,75 » → « 0.75 ») : c'est elle qui sera écrite.
          const c = { quantite: lireContenanceSaisie(aEcrire.quantite, aEcrire.unite).contenance!, unite: aEcrire.unite, uniteStock: uniteManquante(existant.unite) ? aEcrire.uniteStock : null };
          article = { ...article, unite: existant.unite || c.uniteStock!, contenanceAEcrire: c };
          effectif = { unite: article.unite, contenance: c.quantite, contenanceUnite: c.unite };
        } else {
          effectif = { unite: existant.unite, contenance: existant.contenance, contenanceUnite: existant.contenanceUnite };
        }
      } else {
        effectif = { unite: article!.unite };
      }
      if (!unite) return { ...b, article, statut: "BLOQUEE", motif: "unité vide au classeur" };
      if (ln.quantite === null || !(ln.quantite > 0)) return { ...b, article, statut: "BLOQUEE", motif: "quantité absente ou nulle au classeur" };
      // La base garde 3 décimales : une quantité qui s'y arrondirait à 0 (coût nul) ou autrement
      // (coût faussé sans le dire) est bloquée, jamais arrondie en silence.
      if (Math.round(ln.quantite * 1000) / 1000 !== ln.quantite) {
        return { ...b, article, statut: "BLOQUEE", motif: `quantité ${ln.quantite} : plus de 3 décimales, à arrondir dans le classeur` };
      }
      if (!uniteConvertible(unite, effectif)) {
        return { ...b, article, statut: "BLOQUEE", motif: `unité inconvertible : ${unite} → ${article!.unite || "article sans unité"}` };
      }
      return { ...b, article };
    });

    const aDecider = lignes.filter((x) => x.statut === "A_DECIDER").length;
    const bloquees = lignes.filter((x) => x.statut === "BLOQUEE");
    if (aDecider) raisons.push(`${aDecider} ingrédient(s) à décider`);
    for (const x of bloquees) raisons.push(`${x.libelle} : ${x.motif}`);
    const verres = l.verres;
    const verresInvalides = verres === null || !Number.isInteger(verres) || verres < 1;
    if (verresInvalides) raisons.push("nombre de verres absent ou invalide au classeur");
    const vide = !aDecider && !bloquees.length && !lignes.some((x) => x.statut === "OK");
    if (vide) raisons.push("aucun ingrédient à écrire");

    const plan: FichePlan = {
      ...base, cible, lignes, raisons,
      nbPortions: verres !== null && Number.isInteger(verres) && verres >= 1 ? verres : null,
      recette: recetteDe(l, lignes.filter((x) => x.statut === "IGNOREE")),
    };
    if (bloquees.length || verresInvalides || vide) return { ...plan, statut: "BLOQUEE" };
    if (aDecider) return { ...plan, statut: "A_DECIDER" };
    if (cible.nbIngredients > 0 && !c.remplacer) return { ...plan, statut: "DEJA_REMPLIE", raisons: [`« ${cible.nom} » a déjà ${cible.nbIngredients} ingrédient(s) : cocher « Remplacer la recette existante » pour la réécrire`] };
    return { ...plan, statut: "PRETE" };
  });

  // Deux feuilles vers une même fiche (existante, ou créée sous le même nom) : aucune n'est écrite.
  const cleCible = (p: FichePlan) => (p.cible ? (p.cible.id ?? `nouvelle:${cleFicheCreee(p.cible.nom, p.cible.categorie)}`) : null);
  const compte = new Map<string, number>();
  for (const p of plans) if (p.statut !== "IGNOREE") { const k = cleCible(p); if (k) compte.set(k, (compte.get(k) ?? 0) + 1); }
  return plans.map((p) => {
    const k = cleCible(p);
    if (p.statut === "IGNOREE" || !k || compte.get(k)! < 2) return p;
    const autres = plans.filter((x) => x !== p && x.statut !== "IGNOREE" && cleCible(x) === k).map((x) => `« ${x.feuille} »`).join(", ");
    return { ...p, statut: "BLOQUEE", raisons: [...p.raisons, `vise la même fiche que ${autres}`] };
  });
}

// ─── Validation d'une charge reçue du navigateur (serveur) ───────────────────

const MAX_FICHES = 200;
const MAX_LIGNES = 80;
const MAX_TEXTE = 300;
const MAX_TECHNIQUE = 80;
const MAX_LIGNE_TECHNIQUE = 2000;

function texteOuNull(v: unknown, champ: string, max = MAX_TEXTE): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || propre(v).length > max) throw new Error(`Classeur illisible (${champ}).`);
  return propre(v) || null;
}
function texteRequis(v: unknown, champ: string): string {
  const t = texteOuNull(v, champ);
  if (!t) throw new Error(`Classeur illisible (${champ}).`);
  return t;
}
function nombreOuNull(v: unknown, champ: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Classeur illisible (${champ}).`);
  return v;
}

/** Revalide ce que le navigateur a lu : le serveur ne se fie à aucune forme reçue. */
export function validerFichesLues(brut: unknown): FicheBarLue[] {
  if (!Array.isArray(brut) || brut.length === 0) throw new Error("Aucune fiche lue dans le classeur.");
  if (brut.length > MAX_FICHES) throw new Error(`Trop de feuilles (plus de ${MAX_FICHES}) : ce n'est pas le classeur attendu.`);
  const vues = new Set<string>();
  return brut.map((f: Record<string, unknown>) => {
    const feuille = texteRequis(f?.feuille, "feuille");
    if (vues.has(feuille)) throw new Error(`Classeur illisible : feuille « ${feuille} » en double.`);
    vues.add(feuille);
    if (!Array.isArray(f.lignes) || f.lignes.length > MAX_LIGNES) throw new Error(`Classeur illisible (lignes de « ${feuille} »).`);
    if (!Array.isArray(f.technique) || f.technique.length > MAX_TECHNIQUE) throw new Error(`Classeur illisible (technique de « ${feuille} »).`);
    if (!Array.isArray(f.modes) || f.modes.length > 10) throw new Error(`Classeur illisible (modes de « ${feuille} »).`);
    return {
      feuille,
      type: texteOuNull(f.type, "type"),
      nom: texteRequis(f.nom, "nom"),
      verres: nombreOuNull(f.verres, "verres"),
      prixTTC: nombreOuNull(f.prixTTC, "prix"),
      tauxTVA: nombreOuNull(f.tauxTVA, "TVA"),
      modes: f.modes.map((m: unknown) => texteRequis(m, "mode")),
      verre: texteOuNull(f.verre, "verre"),
      lignes: f.lignes.map((l: Record<string, unknown>) => ({
        libelle: texteRequis(l?.libelle, "article"),
        unite: texteOuNull(l?.unite, "unité"),
        quantite: nombreOuNull(l?.quantite, "quantité"),
        coutUnitaire: nombreOuNull(l?.coutUnitaire, "coût"),
      })),
      technique: f.technique.map((t: unknown) => {
        if (typeof t !== "string" || !propre(t) || propre(t).length > MAX_LIGNE_TECHNIQUE) throw new Error(`Classeur illisible (technique de « ${feuille} »).`);
        return propre(t);
      }),
    };
  });
}

const DOMAINES = ["NOURRITURE", "BOISSON", "AUTRE"] as const;

/** Revalide les choix : forme stricte, jamais une valeur inattendue. */
export function validerChoix(brut: unknown, lues: FicheBarLue[]): ChoixImportBar {
  const b = brut as { fiches?: unknown; ingredients?: unknown } | null;
  if (!b || typeof b !== "object" || typeof b.fiches !== "object" || !b.fiches || typeof b.ingredients !== "object" || !b.ingredients) throw new Error("Choix illisibles.");
  const fiches: Record<string, ChoixFiche> = {};
  for (const l of lues) {
    const c = (b.fiches as Record<string, Record<string, unknown>>)[l.feuille];
    if (!c) { fiches[l.feuille] = { cible: "", categorie: "", remplacer: false }; continue; }
    const cible = typeof c.cible === "string" ? c.cible : "";
    if (!(cible === "" || cible === "creer" || cible === "ignorer" || /^fiche:[\w-]{1,64}$/.test(cible))) throw new Error(`Choix illisible pour « ${l.feuille} ».`);
    const categorie = typeof c.categorie === "string" ? propre(c.categorie) : "";
    if (categorie.length > 100) throw new Error(`Rubrique trop longue pour « ${l.feuille} ».`);
    fiches[l.feuille] = { cible, categorie, remplacer: c.remplacer === true };
  }
  const ingredients: Record<string, ChoixIngredient> = {};
  for (const [cle, c] of Object.entries(b.ingredients as Record<string, Record<string, unknown>>)) {
    if (cle.length > MAX_TEXTE) throw new Error("Choix d'ingrédient illisible.");
    const cible = typeof c?.cible === "string" ? c.cible : "";
    if (!(cible === "" || cible === "creer" || cible === "ignorer" || /^art:[\w-]{1,64}$/.test(cible))) throw new Error("Choix d'ingrédient illisible.");
    const domaine = DOMAINES.find((d) => d === c?.domaine) ?? "BOISSON";
    ingredients[cle] = { cible, domaine };
  }
  const contenances: Record<string, ContenanceChoisie> = {};
  const brutes = (b as { contenances?: unknown }).contenances;
  if (brutes !== undefined && (typeof brutes !== "object" || brutes === null)) throw new Error("Contenances illisibles.");
  const entrees = Object.entries((brutes ?? {}) as Record<string, Record<string, unknown>>);
  if (entrees.length > 500) throw new Error("Contenances illisibles.");
  for (const [id, c] of entrees) {
    const quantite = typeof c?.quantite === "string" ? c.quantite.trim() : "";
    const unite = typeof c?.unite === "string" ? c.unite : "";
    const uniteStock = c?.uniteStock === null || c?.uniteStock === undefined ? null : c.uniteStock;
    if (!/^[\w-]{1,64}$/.test(id) || quantite.length > 20 || !(UNITES_CONTENANCE as readonly string[]).includes(unite)
      || (uniteStock !== null && !(UNITES_STOCK_COMPTAGE as readonly unknown[]).includes(uniteStock))) {
      throw new Error("Contenance illisible.");
    }
    contenances[id] = { quantite, unite, uniteStock: uniteStock as string | null };
  }
  return { fiches, ingredients, contenances };
}

/** Domaine proposé pour un article créé : volume → Boisson, sinon Nourriture (modifiable). */
export const domainePropose = (unite: string | null | undefined): ChoixIngredient["domaine"] =>
  unite && facteur(unite, "l") !== null ? "BOISSON" : "NOURRITURE";

/**
 * Choix de départ : les correspondances SÛRES acceptées, tout le reste « à décider ». Pour un
 * article sûr compté à l'unité sans contenance, la contenance LUE dans son nom est pré-remplie
 * (visible et modifiable à l'écran) ; illisible, elle reste vide et la ligne bloquée.
 */
export function choixInitiaux(fiches: PropositionFiche[], ingredients: PropositionIngredient[], articles: ArticleExistant[] = []): ChoixImportBar {
  const parId = new Map(articles.map((a) => [a.id, a]));
  const contenances: Record<string, ContenanceChoisie> = {};
  for (const p of ingredients) {
    const a = p.articleId ? parId.get(p.articleId) : undefined;
    if (a && !contenances[a.id] && contenanceRequise(a, p.unites)) {
      const c = contenanceProposee(a);
      contenances[a.id] = { quantite: c.quantite, unite: c.unite, uniteStock: c.uniteStock };
    }
  }
  return {
    fiches: Object.fromEntries(fiches.map((p) => [p.feuille, { cible: p.ficheId ? `fiche:${p.ficheId}` : "", categorie: p.categorieProposee, remplacer: false }])),
    ingredients: Object.fromEntries(ingredients.map((p) => [p.cle, { cible: p.articleId ? `art:${p.articleId}` : "", domaine: domainePropose(p.creation?.uniteClasseur) }])),
    contenances,
  };
}

// ─── Photos des feuilles (« pareil que les plats ») ──────────────────────────
//
// Chaîne de rattachement lue dans l'archive (même que scripts/import-photos-fiches.ts) :
// workbook.xml (onglet → r:id) → workbook.xml.rels (→ feuille) → _rels de la feuille (→ dessin)
// → _rels du dessin (→ images de xl/media). Une image portée par PLUS DE DEUX feuilles est un logo
// d'en-tête (le classeur du bar en a un sur ses 30 feuilles) : jamais proposée. Une image portée
// par exactement deux feuilles (Mojito / Virgin Mojito) est proposée à chacune, décochée d'office
// et annoncée « partagée ». Plusieurs images sur une feuille : aucune n'est choisie d'office.

export type TypePhoto = "image/png" | "image/jpeg" | "image/webp";
export type PhotoFeuille = {
  feuille: string; chemin: string; type: TypePhoto; octets: Uint8Array; partageeAvec: string[];
  /**
   * Moins de trois feuilles portent des images : le logo d'en-tête (reconnu parce qu'il est sur
   * PLUS de deux feuilles) ne peut pas être distingué d'une photo. Proposée, jamais cochée d'office.
   */
  incertaine: boolean;
};
export type LecturePhotos = { photos: Map<string, PhotoFeuille>; ecartees: { feuille: string; raison: string }[] };

const TYPES_PHOTO: Record<string, TypePhoto> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function resoudre(depuis: string, cible: string): string {
  if (cible.startsWith("/")) return cible.slice(1);
  const parts = depuis.split("/").slice(0, -1);
  for (const p of cible.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}
const cibles = (rels: string, type: RegExp) =>
  [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).filter((r) => type.test(r)).map((r) => /Target="([^"]+)"/.exec(r)?.[1]).filter((x): x is string => !!x);

/** Photos des feuilles nommées `feuilles` (noms d'onglet débarrassés de leurs espaces superflus). Ne lève jamais. */
export async function lirePhotosClasseur(donnees: ArrayBuffer | Uint8Array, feuilles: string[]): Promise<LecturePhotos> {
  const vide: LecturePhotos = { photos: new Map(), ecartees: [] };
  let zip: import("jszip");
  try {
    const JSZip = (await import("jszip")).default;
    zip = await JSZip.loadAsync(donnees);
  } catch {
    return vide;
  }
  const lire = async (chemin: string) => (await zip.file(chemin)?.async("string")) ?? null;
  const classeur = await lire("xl/workbook.xml");
  const liens = await lire("xl/_rels/workbook.xml.rels");
  if (!classeur || !liens) return vide;
  const idVersFeuille = new Map<string, string>();
  for (const m of liens.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1]; const t = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) idVersFeuille.set(id, resoudre("xl/workbook.xml", t));
  }
  const images = new Map<string, string[]>(); // feuille → images
  for (const m of classeur.matchAll(/<sheet\b[^>]*>/g)) {
    const nom = /name="([^"]*)"/.exec(m[0])?.[1];
    const id = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const chemin = id ? idVersFeuille.get(id) : undefined;
    if (!nom || !chemin) continue;
    const feuille = propre(nom.replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
    const relsFeuille = chemin.replace(/([^/]+)$/, "_rels/$1.rels");
    const rf = await lire(relsFeuille);
    const media: string[] = [];
    for (const d of rf ? cibles(rf, /relationships\/drawing"/) : []) {
      const dessin = resoudre(chemin, d);
      const rd = await lire(dessin.replace(/([^/]+)$/, "_rels/$1.rels"));
      for (const i of rd ? cibles(rd, /relationships\/image"/) : []) media.push(resoudre(dessin, i));
    }
    images.set(feuille, [...new Set(media)]);
  }
  const porteurs = new Map<string, string[]>();
  for (const [f, ms] of images) for (const m of ms) porteurs.set(m, [...(porteurs.get(m) ?? []), f]);

  // Critère SÛR du logo : présent sur plus de deux feuilles. Avec moins de trois feuilles illustrées,
  // il n'existe pas : tout ce qui reste est « incertain » (la position dans la feuille ne l'est pas).
  const incertaine = [...images.values()].filter((ms) => ms.length > 0).length < 3;
  const res: LecturePhotos = { photos: new Map(), ecartees: [] };
  for (const feuille of feuilles) {
    const candidates = (images.get(feuille) ?? []).filter((m) => (porteurs.get(m)?.length ?? 0) <= 2);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) { res.ecartees.push({ feuille, raison: `${candidates.length} images sur la feuille : aucune choisie d'office` }); continue; }
    const chemin = candidates[0]!;
    const type = TYPES_PHOTO[chemin.split(".").pop()!.toLowerCase()];
    if (!type) { res.ecartees.push({ feuille, raison: `format « ${chemin.split(".").pop()} » non pris en charge (PNG, JPG ou WEBP)` }); continue; }
    const octets = await zip.file(chemin)?.async("uint8array");
    if (!octets) continue;
    res.photos.set(feuille, { feuille, chemin, type, octets, partageeAvec: porteurs.get(chemin)!.filter((f) => f !== feuille), incertaine });
  }
  return res;
}
