import { normTexte } from "@/lib/texte";

// Ventes journalières du restaurant (Conso. journalière → Ventes, et fiche « Rapport journalier
// cuisine et bar »), d'après le classeur de la Direction « PEF Rapport journalier cuisine et bar » :
// une feuille Cuisine (les PLATS vendus, par rubrique) et une feuille Bar (les BOISSONS vendues, par
// rubrique), une colonne par jour, du lundi au samedi.
//
// Fonctions PURES (ni Prisma, ni React). Règles :
//   - les lignes sont des UNITÉS DE VENTE de l'application, jamais une liste recopiée en dur :
//     Cuisine = les fiches techniques « Plat vendu » (type PLAT) ; Bar = les fiches techniques de
//     type BAR (verre de vin, cocktail, café…). Les bouteilles du stock bar ne sont PAS des lignes
//     de vente (décision de la Direction, 2026-09-29) ; leur consommation se déduira plus tard de la
//     recette de la fiche Bar. Une ligne du classeur absente de l'application se crée par le geste
//     « Importer les lignes du classeur » (lib/classeur-ventes), jamais d'office ;
//   - aucun rattachement deviné : une vente est enregistrée sur LA ligne que l'utilisateur a saisie ;
//   - case vide = pas de saisie (« — »), jamais 0 ; 0 saisi = 0.

export type EspaceVente = "CUISINE" | "BAR";

/** Ligne du rapport : une unité de vente (fiche technique PLAT ou BAR). */
export type LigneVente = {
  /** Clé stable de la ligne : `fiche:<id>`. */
  cle: string;
  designation: string;
  /** Rubrique (catégorie de la fiche ou de l'article), « Sans rubrique » à défaut. */
  rubrique: string;
  espace: EspaceVente;
  /** Fiche désactivée depuis, affichée parce qu'elle porte des ventes cette semaine. */
  inactif: boolean;
};

export const SANS_RUBRIQUE = "Sans rubrique";
/** Séparateur d'une sous-rubrique (« Vin rouge — Français ») et d'un format (« Vin blanc maison — Verre »). */
export const SEPARATEUR_SOUS_RUBRIQUE = " — ";

/**
 * Ordre des rubriques du classeur, feuille Cuisine. Sert UNIQUEMENT à ranger les rubriques des
 * fiches (comparaison sans accents ni casse) ; une rubrique inconnue du classeur vient après, par
 * ordre alphabétique. Aucune ligne n'est créée d'après cette liste.
 */
export const RUBRIQUES_CUISINE = [
  "Entrées froides", "Entrées chaudes", "Pâtes classiques", "Pâtes en Folie", "Pâtes",
  "Autres accompagnements", "Desserts", "Supplément",
];

/** Idem, feuille Bar. */
export const RUBRIQUES_BAR = [
  "Eau plate", "Eau pétillante", "Limonade et autre", "Bière locale", "Bière importée", "Sirop et accompagnement",
  "Jus de fruit", "Mocktail", "Apéritif", "Vin blanc", "Vin rosé", "Vin rouge", "Vin mousseux", "Champagne",
  "Boisson chaude", "Digestif", "Gin, Vodka et Tequila", "Rhum", "Whisky", "Cocktail",
];

const PREFIXE_FICHE = "fiche:";

export const cleFiche = (id: string) => `${PREFIXE_FICHE}${id}`;

/** Lit une clé de ligne ; null si elle ne désigne pas une fiche. */
export function lireCleLigne(cle: string): { type: "fiche"; id: string } | null {
  if (cle.startsWith(PREFIXE_FICHE) && cle.length > PREFIXE_FICHE.length) return { type: "fiche", id: cle.slice(PREFIXE_FICHE.length) };
  return null;
}

/** Clé d'une case (ligne × jour) dans la carte des ventes. */
export const cleCase = (ligne: string, jour: string) => `${ligne}_${jour}`;

// ─── Construction et ordre des lignes ────────────────────────────────────────

export type FicheVendue = {
  id: string; nom: string; categorie: string | null; type: "PLAT" | "BAR"; actif: boolean;
  /** Libellé du classeur (import) ; null = le nom de la fiche. */
  libelleVente?: string | null;
  /** Rang de la ligne dans le classeur (import) ; null = après les lignes du classeur. */
  ordreVente?: number | null;
};

const compare = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });
const INFINI = Number.POSITIVE_INFINITY;

/** Rang d'une rubrique dans l'ordre du classeur (sans accents ni casse) ; inconnue = à la fin. */
function rangClasseur(rubrique: string, reference: string[]): number {
  const n = normTexte(rubrique.trim());
  const i = reference.findIndex((r) => normTexte(r) === n);
  if (i >= 0) return i;
  // Sous-rubrique « Vin rouge — Français » : juste après sa rubrique.
  const j = reference.findIndex((r) => n.startsWith(`${normTexte(r)} ${SEPARATEUR_SOUS_RUBRIQUE.trim()} `));
  return j < 0 ? INFINI : j + 0.5;
}

/**
 * Lignes du rapport pour un espace, dans l'ordre d'affichage : fiches PLAT (Cuisine) ou BAR (Bar),
 * sous leur libellé du classeur quand l'import l'a posé.
 *  - Ordre du CLASSEUR d'abord : les lignes importées gardent leur rang (`ordreVente`) et leur
 *    rubrique arrive à la place de sa première ligne ;
 *  - puis les rubriques sans ligne importée, dans l'ordre des rubriques du classeur de PEF, les
 *    inconnues par ordre alphabétique ; « Sans rubrique » ferme la marche ;
 *  - dans une rubrique : lignes importées dans l'ordre du classeur, puis les autres par nom.
 * Une même rubrique à la casse et aux accents près n'en fait qu'une.
 */
export function lignesDuRapport(espace: EspaceVente, fiches: FicheVendue[]): LigneVente[] {
  const avecRang = fiches
    .filter((f) => (espace === "CUISINE" ? f.type === "PLAT" : f.type === "BAR"))
    .map((f) => ({
      ligne: {
        cle: cleFiche(f.id),
        designation: (f.libelleVente?.trim() || f.nom).trim(),
        rubrique: f.categorie?.trim() || SANS_RUBRIQUE,
        espace,
        inactif: !f.actif,
      } as LigneVente,
      rang: f.ordreVente ?? INFINI,
    }))
    .sort((a, b) => a.rang - b.rang || compare(a.ligne.designation, b.ligne.designation));

  const orthographe = new Map<string, string>();
  for (const { ligne } of avecRang) {
    const n = normTexte(ligne.rubrique);
    if (!orthographe.has(n)) orthographe.set(n, ligne.rubrique);
    ligne.rubrique = orthographe.get(n)!;
  }

  const reference = espace === "CUISINE" ? RUBRIQUES_CUISINE : RUBRIQUES_BAR;
  const premierRang = new Map<string, number>();
  for (const { ligne, rang } of avecRang) premierRang.set(ligne.rubrique, Math.min(premierRang.get(ligne.rubrique) ?? INFINI, rang));
  const cle = (r: string): [number, number, number] => [r === SANS_RUBRIQUE ? 1 : 0, premierRang.get(r) ?? INFINI, rangClasseur(r, reference)];
  const rubriques = [...premierRang.keys()].sort((a, b) => {
    const [xa, ya, za] = cle(a), [xb, yb, zb] = cle(b);
    return xa - xb || (ya === yb ? (za === zb ? compare(a, b) : za - zb) : ya - yb);
  });
  return rubriques.flatMap((r) => avecRang.filter((x) => x.ligne.rubrique === r).map((x) => x.ligne));
}

// ─── Semaine affichée ────────────────────────────────────────────────────────

/**
 * Le rapport va du lundi au samedi, comme le classeur ; le dimanche (7e jour) s'y ajoute dès qu'une
 * vente y est saisie — une donnée n'est jamais cachée pour tenir dans le modèle — ou à la demande
 * (pour saisir un dimanche). `ventes` : carte `cleCase(ligne, jour)` → quantité.
 */
export function avecDimanche(jours: string[], ventes: ReadonlyMap<string, number> | Record<string, number>, demande = false): boolean {
  if (demande) return true;
  const dimanche = jours[6];
  if (!dimanche) return false;
  const suffixe = `_${dimanche}`;
  const cles = ventes instanceof Map ? [...ventes.keys()] : Object.keys(ventes);
  return cles.some((k) => k.endsWith(suffixe));
}

/** Validation d'une saisie : nombre vendu entier ≥ 0, ou null (case vidée = saisie retirée). */
export function lireQuantiteVendue(q: unknown): { ok: true; valeur: number | null } | { ok: false; erreur: string } {
  if (q === null || q === undefined) return { ok: true, valeur: null };
  const n = typeof q === "number" ? q : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false, erreur: "Quantité vendue invalide (nombre positif ou nul attendu)." };
  if (!Number.isInteger(n)) return { ok: false, erreur: "Quantité vendue invalide : un nombre entier est attendu." };
  if (n > 100_000) return { ok: false, erreur: "Quantité vendue invalide : plus de 100 000 en un jour." };
  return { ok: true, valeur: n };
}
