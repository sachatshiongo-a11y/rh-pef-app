import { normTexte } from "@/lib/texte";

// Ventes journalières du restaurant (Conso. journalière → Ventes, et fiche « Rapport journalier
// cuisine et bar »), d'après le classeur de la Direction « PEF Rapport journalier cuisine et bar » :
// une feuille Cuisine (les PLATS vendus, par rubrique) et une feuille Bar (les BOISSONS vendues, par
// rubrique), une colonne par jour, du lundi au samedi.
//
// Fonctions PURES (ni Prisma, ni React). Règles :
//   - les lignes viennent de l'application, jamais d'une liste recopiée du classeur : Cuisine = les
//     fiches techniques « Plat vendu » (type PLAT) ; Bar = les articles du bar (écran Stock
//     restaurant) et les fiches techniques de type BAR (cocktails…). Un plat du classeur absent de
//     l'application n'est PAS créé : la Direction crée sa fiche, il apparaît alors ;
//   - aucun rattachement deviné : une vente est enregistrée sur LA ligne que l'utilisateur a saisie ;
//   - case vide = pas de saisie (« — »), jamais 0 ; 0 saisi = 0.

export type EspaceVente = "CUISINE" | "BAR";

/** Ligne du rapport : un plat (fiche technique) ou une boisson (article du bar). */
export type LigneVente = {
  /** Clé stable de la ligne : `fiche:<id>` ou `resto:<id>`. */
  cle: string;
  designation: string;
  /** Rubrique (catégorie de la fiche ou de l'article), « Sans rubrique » à défaut. */
  rubrique: string;
  espace: EspaceVente;
  /** Fiche ou article désactivé depuis, affiché parce qu'il porte des ventes cette semaine. */
  inactif: boolean;
};

export const SANS_RUBRIQUE = "Sans rubrique";

/**
 * Ordre des rubriques du classeur, feuille Cuisine. Sert UNIQUEMENT à ranger les rubriques des
 * fiches (comparaison sans accents ni casse) ; une rubrique inconnue du classeur vient après, par
 * ordre alphabétique. Aucune ligne n'est créée d'après cette liste.
 */
export const RUBRIQUES_CUISINE = [
  "Entrées froides", "Entrées chaudes", "Pâtes classiques", "Pâtes en Folie", "Pâtes",
  "Autres accompagnements", "Desserts", "Supplément",
];

/** Idem, feuille Bar (pour les rubriques des fiches Bar absentes des articles du bar). */
export const RUBRIQUES_BAR = [
  "Eau plate", "Eau pétillante", "Limonade et autre", "Bière locale", "Bière importée", "Sirop et accompagnement",
  "Jus de fruit", "Mocktail", "Apéritif", "Vin blanc", "Vin rosé", "Vin rouge", "Vin mousseux", "Champagne",
  "Boisson chaude", "Digestif", "Gin, Vodka et Tequila", "Rhum", "Whisky", "Cocktail",
];

const PREFIXE_FICHE = "fiche:";
const PREFIXE_RESTO = "resto:";

export const cleFiche = (id: string) => `${PREFIXE_FICHE}${id}`;
export const cleResto = (id: string) => `${PREFIXE_RESTO}${id}`;

/** Lit une clé de ligne ; null si elle n'est ni une fiche ni un article du bar. */
export function lireCleLigne(cle: string): { type: "fiche" | "resto"; id: string } | null {
  if (cle.startsWith(PREFIXE_FICHE) && cle.length > PREFIXE_FICHE.length) return { type: "fiche", id: cle.slice(PREFIXE_FICHE.length) };
  if (cle.startsWith(PREFIXE_RESTO) && cle.length > PREFIXE_RESTO.length) return { type: "resto", id: cle.slice(PREFIXE_RESTO.length) };
  return null;
}

/** Clé d'une case (ligne × jour) dans la carte des ventes. */
export const cleCase = (ligne: string, jour: string) => `${ligne}_${jour}`;

// ─── Construction et ordre des lignes ────────────────────────────────────────

export type FicheVendue = { id: string; nom: string; categorie: string | null; type: "PLAT" | "BAR"; actif: boolean };
export type BoissonBar = { id: string; designation: string; unite: string | null; categorie: string | null; ordre: number; actif: boolean };

const rubriqueDe = (c: string | null | undefined) => c?.trim() || SANS_RUBRIQUE;
const compare = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base", numeric: true });

function rangClasseur(rubrique: string, reference: string[]): number {
  const n = normTexte(rubrique.trim());
  const i = reference.findIndex((r) => normTexte(r) === n);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/**
 * Lignes du rapport pour un espace, dans l'ordre d'affichage :
 *  - Cuisine : fiches PLAT ; rubriques dans l'ordre du classeur (inconnues après, alphabétiques),
 *    plats par nom ;
 *  - Bar : articles du bar dans l'ORDRE DE L'ÉCRAN Stock restaurant (leur rubrique arrive à sa
 *    première apparition), puis les fiches BAR — dans la rubrique d'un article si elle existe, sinon
 *    dans une rubrique rangée selon le classeur, puis alphabétique.
 * « Sans rubrique » ferme toujours la marche.
 */
export function lignesDuRapport(espace: EspaceVente, fiches: FicheVendue[], boissons: BoissonBar[] = []): LigneVente[] {
  const deFiche = (f: FicheVendue): LigneVente => ({ cle: cleFiche(f.id), designation: f.nom.trim(), rubrique: rubriqueDe(f.categorie), espace, inactif: !f.actif });
  const lignesFiches = fiches
    .filter((f) => (espace === "CUISINE" ? f.type === "PLAT" : f.type === "BAR"))
    .map(deFiche)
    .sort((a, b) => compare(a.designation, b.designation));

  const lignesBoissons: LigneVente[] = espace === "BAR"
    ? [...boissons]
        .sort((a, b) => a.ordre - b.ordre || compare(a.designation, b.designation))
        .map((b) => ({
          cle: cleResto(b.id),
          designation: `${b.designation.trim()}${b.unite?.trim() ? ` (${b.unite.trim()})` : ""}`,
          rubrique: rubriqueDe(b.categorie),
          espace,
          inactif: !b.actif,
        }))
    : [];

  // Même rubrique à la casse et aux accents près (« Vin blanc » / « Vin Blanc ») : une seule, sous
  // l'orthographe des articles du bar (puis celle de la première fiche rencontrée).
  const orthographe = new Map<string, string>();
  for (const l of [...lignesBoissons, ...lignesFiches]) {
    const n = normTexte(l.rubrique);
    if (!orthographe.has(n)) orthographe.set(n, l.rubrique);
    l.rubrique = orthographe.get(n)!;
  }

  // Rubriques : rang principal (ordre de l'écran pour les articles du bar, sinon classeur), puis nom.
  const reference = espace === "CUISINE" ? RUBRIQUES_CUISINE : RUBRIQUES_BAR;
  const rangs = new Map<string, [number, number]>();
  lignesBoissons.forEach((l, i) => { if (!rangs.has(l.rubrique)) rangs.set(l.rubrique, [0, i]); });
  for (const l of lignesFiches) if (!rangs.has(l.rubrique)) rangs.set(l.rubrique, [1, rangClasseur(l.rubrique, reference)]);
  const cleRubrique = (r: string): [number, number, number] => {
    const [groupe, rang] = rangs.get(r) ?? [1, Number.POSITIVE_INFINITY];
    return [r === SANS_RUBRIQUE ? 1 : 0, groupe, rang];
  };
  const rubriques = [...rangs.keys()].sort((a, b) => {
    const [xa, ya, za] = cleRubrique(a), [xb, yb, zb] = cleRubrique(b);
    return xa - xb || ya - yb || (za === zb ? compare(a, b) : za - zb);
  });

  return rubriques.flatMap((r) => [...lignesBoissons.filter((l) => l.rubrique === r), ...lignesFiches.filter((l) => l.rubrique === r)]);
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
