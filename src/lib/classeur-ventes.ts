import { colonneDesignation, cleTexte, lireFeuillesXlsx, propre } from "@/lib/xlsx-leger";
import { SANS_RUBRIQUE, SEPARATEUR_SOUS_RUBRIQUE, type EspaceVente } from "@/lib/ventes-journalieres";

// « Importer les lignes du classeur » (Conso. journalière → Ventes, 2026-09-29) : la Direction dépose
// son classeur « Rapport journalier cuisine et bar » ; l'application en lit les lignes (feuille
// Cuisine → fiches « Plat vendu », feuille Bar → fiches Bar), les compare aux fiches existantes et
// PROPOSE — la Direction coche, rien n'est créé ni rattaché d'office.
//
// Fonctions PURES, utilisables dans le navigateur (lecture du fichier) comme sur le serveur (tests) :
//  - `lireClasseurVentes` : ouvre le .xlsx (une archive zip) et ne décompresse QUE le classeur, les
//    textes partagés, les styles et les deux feuilles — jamais les images (le classeur de PEF pèse
//    25 Mo à cause d'un logo TIFF). Un fichier qui n'est pas ce classeur est refusé en clair ;
//  - `analyserLignesClasseur` : présente / absente / « proche de … », jamais fusionnée.
//
// Lecture des feuilles, telle que le classeur est construit (aucune coordonnée en dur) :
//  - la colonne des désignations est celle de la cellule « Designation/Date » ; les lignes suivent ;
//  - une cellule en GRAS est une rubrique ; deux rubriques consécutives font une sous-rubrique
//    (« Vin rouge » puis « Français » → « Vin rouge — Français ») ;
//  - une ligne « Verre », « Pichet 1/4 », « Pichet 1/2 », « Bouteille », « Coupe » est un FORMAT de
//    la ligne qui la précède (« Vin blanc maison — Verre ») ; cette ligne-là devient alors un simple
//    intitulé et n'est pas une unité de vente ;
//  - les en-têtes répétés (« Designation/Date », jours, dates) et les nombres sont ignorés.

export { TAILLE_MAX_CLASSEUR } from "@/lib/xlsx-leger";

/** Formats de vente d'une boisson, écrits en ligne sous elle dans le classeur. */
export const FORMATS_DE_VENTE = ["verre", "pichet 1/4", "pichet 1/2", "bouteille", "coupe", "carafe", "demi-bouteille", "1/2 bouteille"];

/** Rubriques décochées par défaut : « Pâtes » (Farfalle, Penne… = le choix d'une forme, pas une vente). */
export const RUBRIQUES_DECOCHEES = ["Pâtes"];

export type LigneClasseur = {
  feuille: EspaceVente;
  /** Rubrique telle que lue (sous-rubrique comprise). */
  rubrique: string;
  /** Libellé exact du classeur (espaces superflus retirés). */
  nom: string;
  /** Rang dans la feuille (1, 2, 3…) : l'ordre du classeur. */
  rang: number;
  /** Numéro de la rangée dans la feuille Excel (lecture d'un classeur ; le document du jour s'y cale, lib/modeles-journaliers). */
  ligne?: number;
};

export type LectureClasseur = { ok: true; lignes: LigneClasseur[] } | { ok: false; erreur: string };

const REFUS_CLASSEUR =
  "Ce fichier n'est pas le classeur « Rapport journalier cuisine et bar » : il faut une feuille « Cuisine » et une feuille « Bar », chacune avec une colonne « Designation/Date ».";

/** Lit le classeur (octets du .xlsx). Ne lève jamais : un refus revient en `{ ok: false, erreur }`. */
export async function lireClasseurVentes(donnees: ArrayBuffer | Uint8Array): Promise<LectureClasseur> {
  const lu = await lireFeuillesXlsx(donnees, (nom) => nom === "cuisine" || nom === "bar");
  if (!lu.ok) return lu;
  const lignes: LigneClasseur[] = [];
  for (const [feuille, nom] of [["CUISINE", "cuisine"], ["BAR", "bar"]] as const) {
    const rangees = lu.feuilles.get(nom);
    if (!rangees) return { ok: false, erreur: REFUS_CLASSEUR };
    const tete = colonneDesignation(rangees);
    if (!tete) return { ok: false, erreur: REFUS_CLASSEUR };
    const { col, entete: iEntete } = tete;

    let rubrique: string | null = null;
    let titrePrecedent: string | null = null; // rubrique « nue » de la rangée précédente, si c'en était une
    let base: { index: number; aDesFormats: boolean } | null = null;
    const aRetirer = new Set<number>();
    const debut = lignes.length;
    for (const cs of rangees.slice(iEntete + 1)) {
      const c = cs.find((x) => x.col === col);
      if (!c?.texte || cleTexte(c.texte).startsWith("designation")) continue;
      if (c.gras) {
        rubrique = titrePrecedent !== null ? `${titrePrecedent}${SEPARATEUR_SOUS_RUBRIQUE}${c.texte}` : c.texte;
        titrePrecedent = titrePrecedent !== null ? null : c.texte;
        base = null;
        continue;
      }
      titrePrecedent = null;
      const r = rubrique ?? SANS_RUBRIQUE;
      if (FORMATS_DE_VENTE.includes(cleTexte(c.texte))) {
        const parent = base !== null ? lignes[base.index]!.nom : r;
        if (base !== null) { base.aDesFormats = true; aRetirer.add(base.index); }
        lignes.push({ feuille, rubrique: r, nom: `${parent}${SEPARATEUR_SOUS_RUBRIQUE}${c.texte}`, rang: 0, ligne: c.ligne });
      } else {
        lignes.push({ feuille, rubrique: r, nom: c.texte, rang: 0, ligne: c.ligne });
        base = { index: lignes.length - 1, aDesFormats: false };
      }
    }
    // Les intitulés de formats (« Vin blanc maison ») ne sont pas des lignes ; rang = ordre du classeur.
    const gardees = lignes.splice(debut).filter((_, i) => !aRetirer.has(debut + i));
    const vues = new Set<string>();
    let rang = 0;
    for (const l of gardees) {
      const k = `${cleTexte(l.rubrique)}|${cleTexte(l.nom)}`;
      if (vues.has(k)) continue;
      vues.add(k);
      lignes.push({ ...l, rang: ++rang });
    }
  }
  if (!lignes.some((l) => l.feuille === "CUISINE") || !lignes.some((l) => l.feuille === "BAR")) return { ok: false, erreur: REFUS_CLASSEUR };
  return { ok: true, lignes };
}

// ─── Comparaison avec les fiches existantes ──────────────────────────────────

/** Mots vides ignorés dans la ressemblance de deux libellés. */
const MOTS_VIDES = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "s", "et", "a", "au", "aux", "en", "avec", "sa", "ses", "son", "nos", "notre", "comme", "facon", "a la", "sur", "par", "pour", "un", "une"]);
const NOMBRES: Record<string, string> = { un: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", six: "6" };

/** Mots significatifs d'un libellé, au singulier (« cossas » = « cossa », « blancs » = « blanc »). */
function mots(s: string): string[] {
  return cleTexte(s).split(/[^a-z0-9]+/).filter((m) => m.length > 1 && !MOTS_VIDES.has(m))
    .map((m) => NOMBRES[m] ?? (m.length > 3 && m.endsWith("s") ? m.slice(0, -1) : m));
}

/** Distance d'édition avec transposition (« gery » / « grey » = 1). */
export function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Deux mots « se ressemblent » : identiques, ou une faute de frappe près (mots de 4 lettres et plus ; les nombres jamais). */
function motsProches(a: string, b: string): "egal" | "flou" | null {
  if (a === b) return "egal";
  if (/\d/.test(a) || /\d/.test(b)) return null;
  const n = Math.min(a.length, b.length);
  const max = n >= 8 ? 2 : n >= 4 ? 1 : 0;
  return max > 0 && distance(a, b) <= max ? "flou" : null;
}

/**
 * Ressemblance de deux libellés : part des mots du plus court retrouvés dans l'autre (0 → 1), et
 * `flou` si l'un d'eux n'est retrouvé qu'à une faute de frappe près.
 */
export function ressemblance(a: string, b: string, base: "court" | "premier" = "court"): { score: number; flou: boolean } {
  const ma = mots(a), mb = mots(b);
  // « premier » : la part des mots de `a` retrouvés dans `b` (faute de frappe d'un libellé du classeur).
  const [court, long] = base === "premier" || ma.length <= mb.length ? [ma, mb] : [mb, ma];
  if (court.length === 0) return { score: 0, flou: false };
  const libres = [...long];
  let trouves = 0, flou = false;
  for (const m of court) {
    let k = libres.findIndex((x) => motsProches(m, x) === "egal");
    if (k < 0) { k = libres.findIndex((x) => motsProches(m, x) === "flou"); if (k >= 0) flou = true; }
    if (k >= 0) { trouves++; libres.splice(k, 1); }
  }
  return { score: trouves / court.length, flou };
}

/** Au-delà, deux libellés sont signalés « proches ». */
export const SEUIL_PROCHE = 0.6;

export type FicheExistante = { id: string; nom: string; categorie: string | null; type: "PLAT" | "BAR"; estSousRecette: boolean; libelleVente: string | null };

export type ActionImport = "creer" | "rattacher" | "ordre" | "ignorer";

export type PropositionImport = {
  /** Identifiant stable de la proposition (feuille|rubrique|nom). */
  cle: string;
  feuille: EspaceVente;
  type: "PLAT" | "BAR";
  rubriqueClasseur: string;
  /** Rubrique proposée pour la fiche : l'orthographe déjà en usage dans l'application, sinon celle du classeur. */
  rubrique: string;
  nom: string;
  rang: number;
  /** PRESENTE : la fiche existe (même nom), son libellé et son rang seront repris ; ABSENTE : à créer. */
  statut: "PRESENTE" | "ABSENTE";
  /** Fiche existante (présente) ou candidate au rattachement (première des proches). */
  ficheId: string | null;
  /** Signalements « proche de … » : jamais fusionnés d'office. */
  proches: { ficheId: string | null; libelle: string }[];
  /** Geste proposé par défaut. */
  action: ActionImport;
};

const TYPE_DE: Record<EspaceVente, "PLAT" | "BAR"> = { CUISINE: "PLAT", BAR: "BAR" };
const libelleFiche = (f: FicheExistante) =>
  `${f.nom}${f.categorie ? ` (${f.categorie})` : ""}${f.estSousRecette ? " — sous-recette" : ""}${f.type === "BAR" ? " — fiche Bar" : ""}`;

/**
 * Compare les lignes du classeur aux fiches existantes (et, pour le Bar, aux articles du stock bar,
 * pour signaler une FAUTE DE FRAPPE : « Gery Goose » / « Grey Goose 75cl »).
 *  - présente : une fiche du même type, pas une sous-recette, porte ce nom (ou ce libellé) — et,
 *    si le nom revient plusieurs fois dans la feuille (« Heineken » en bière locale et importée),
 *    dans la même rubrique ;
 *  - proche : même nom ailleurs (autre rubrique, autre type, sous-recette), ou libellé ressemblant ;
 *    décochée par défaut, jamais fusionnée ;
 *  - rubrique « Pâtes » : décochée par défaut.
 */
export function analyserLignesClasseur(lignes: LigneClasseur[], fiches: FicheExistante[], articlesBar: string[] = []): PropositionImport[] {
  const occurrences = new Map<string, number>();
  for (const l of lignes) { const k = `${l.feuille}|${cleTexte(l.nom)}`; occurrences.set(k, (occurrences.get(k) ?? 0) + 1); }

  return lignes.map((l) => {
    const type = TYPE_DE[l.feuille];
    const n = cleTexte(l.nom);
    const doublon = (occurrences.get(`${l.feuille}|${n}`) ?? 0) > 1;
    const memeType = fiches.filter((f) => f.type === type && !f.estSousRecette);
    const rubriqueEnUsage = memeType.find((f) => f.categorie && cleTexte(f.categorie) === cleTexte(l.rubrique))?.categorie;
    const rubrique = rubriqueEnUsage ?? propre(l.rubrique);
    const memeNom = (f: FicheExistante) => cleTexte(f.nom) === n || (f.libelleVente !== null && cleTexte(f.libelleVente) === n);
    const presente = memeType.find((f) => memeNom(f) && (!doublon || cleTexte(f.categorie ?? "") === cleTexte(rubrique)));

    const base = { cle: `${l.feuille}|${cleTexte(l.rubrique)}|${n}`, feuille: l.feuille, type, rubriqueClasseur: l.rubrique, rubrique, nom: l.nom, rang: l.rang };
    if (presente) return { ...base, statut: "PRESENTE" as const, ficheId: presente.id, proches: [], action: "ordre" as const };

    const proches: PropositionImport["proches"] = [];
    for (const f of fiches) {
      if (memeNom(f)) { proches.push({ ficheId: f.type === type && !f.estSousRecette ? f.id : null, libelle: `même nom : ${libelleFiche(f)}` }); continue; }
      if (f.type !== type || f.estSousRecette) continue;
      if (ressemblance(l.nom, f.nom).score >= SEUIL_PROCHE) proches.push({ ficheId: f.id, libelle: libelleFiche(f) });
    }
    // Faute de frappe probable (« Gery Goose » / « Grey Goose 75cl ») : au moins deux mots du
    // libellé, tous retrouvés, dont un à une lettre près — et aucun article qui l'écrive exactement.
    if (l.feuille === "BAR" && mots(l.nom).length >= 2) {
      const scores = articlesBar.map((a) => ({ a, r: ressemblance(l.nom, a, "premier") }));
      if (!scores.some((x) => x.r.score === 1 && !x.r.flou)) {
        for (const { a, r } of scores) if (r.flou && r.score === 1) proches.push({ ficheId: null, libelle: `orthographe proche de l'article du bar « ${propre(a)} »` });
      }
    }
    const decochee = RUBRIQUES_DECOCHEES.some((r) => cleTexte(r) === cleTexte(l.rubrique));
    return {
      ...base, statut: "ABSENTE" as const,
      ficheId: proches.find((p) => p.ficheId !== null)?.ficheId ?? null,
      proches,
      action: (proches.length > 0 || decochee ? "ignorer" : "creer") as ActionImport,
    };
  });
}
