import { formaterFC, formaterNombre, formaterUSD, normaliserEspaces } from "@/lib/montant";
import type { PrixUnitaireAchat } from "@/lib/achats-liste";
import type { Cellule, Colonne, TableSpec } from "@/lib/pdf/tableau";

/**
 * Mise en forme PDF des rapports de l'espace Stock (Stock → … → « Exporter / Rapports »).
 *
 * Les données des rapports (`lib/rapports.ts`) restent des NOMBRES bruts : l'Excel en a besoin
 * (cellules numériques, ligne « Total » qui s'additionne). Le PDF, lui, les écrivait tels quels
 * (« 100000 », « 1505.39 », voire « 7526.950000000001 ») : c'est ici qu'ils prennent le format
 * maison (espaces de milliers normalisées, virgule décimale), colonne par colonne, d'après
 * l'EN-TÊTE — jamais d'après la position.
 */

const JOUR = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Libellé de période des rapports : « du 01 septembre 2026 au 28 septembre 2026 ».
 * Jamais « → » : Optima, la police des PDF, n'a pas ce glyphe (repli sur une police standard,
 * rendu « ' » sur le rapport de légumes).
 */
export function libellePeriodeRapport(debut: Date, fin: Date): string {
  return `du ${JOUR(debut)} au ${JOUR(fin)}`;
}

/** Colonne d'argent en dollars (2 décimales fixes) ou en francs (sans décimale), d'après l'en-tête. */
function genreColonne(entete: string): "usd" | "cdf" | "nombre" {
  if (/\bUSD\b|\$/.test(entete)) return "usd";
  if (/\b(CDF|FC)\b/.test(entete)) return "cdf";
  return "nombre";
}

/**
 * Texte d'une cellule de rapport dans le PDF.
 * - nombre : format maison selon la colonne (USD 2 décimales, CDF entier, sinon ≤ 3 décimales) ;
 * - variation « ↑ 12 % » / « ↓ 5 % » : Optima n'a pas les flèches → « +12 % » / « −5 % » ;
 * - tout autre texte : tel quel.
 */
export function celluleRapportPdf(entete: string, valeur: CelluleRapport | null | undefined): Cellule {
  if (valeur === null || valeur === undefined) return "";
  // Cellule déjà mise en forme (texte + précision en petit) : passe telle quelle, espaces normalisées.
  if (typeof valeur === "object") return { texte: normaliserEspaces(valeur.texte), ...(valeur.note ? { note: normaliserEspaces(valeur.note) } : {}) };
  if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) return "—";
    const genre = genreColonne(entete);
    if (genre === "usd") return formaterNombre(valeur, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (genre === "cdf") return formaterNombre(valeur, { maximumFractionDigits: 0 });
    return formaterNombre(valeur, { maximumFractionDigits: 3 });
  }
  return valeur.replace(/↑\s*/g, "+").replace(/↓\s*/g, "−");
}

/** Cellule d'un rapport : nombre brut, texte, ou texte déjà mis en forme avec une précision en petit (PDF seulement). */
export type CelluleRapport = string | number | { texte: string; note?: string };
type TableauRapport = { entete: string[]; lignes: CelluleRapport[][]; largeurs: string[]; droite: number[]; sommables?: number[] };

/**
 * Prix unitaire d'une ligne d'achat dans un PDF : dans la devise SAISIE (« 1,70 $ », « 4 760 FC »),
 * suivi en petit de son équivalent USD pour une ligne en francs (« ≈ 1,70 $ »), ou de la mention
 * « catalogue » quand il ne vient pas de l'achat. Inconnu : « — », jamais 0.
 */
export function cellulePrixUnitairePdf(pu: PrixUnitaireAchat): Cellule {
  if (!pu) return "—";
  const texte = pu.devise === "CDF" ? formaterFC(pu.valeur) : formaterUSD(pu.valeur);
  if (pu.source === "catalogue") return { texte, note: "catalogue" };
  if (pu.devise === "CDF" && pu.equivalentUSD !== null) return { texte, note: `≈ ${formaterUSD(pu.equivalentUSD)}` };
  return texte;
}

/** Somme d'une colonne, arrondie au centime (même calcul que la ligne « Total » de l'Excel). */
function somme(lignes: CelluleRapport[][], ci: number): number {
  let s = 0;
  for (const l of lignes) {
    const v = Number(l[ci]);
    if (typeof l[ci] === "number" && Number.isFinite(v)) s += v;
  }
  return Math.round(s * 100) / 100;
}

/** Tableau de rapport → tableau PDF : colonnes, cellules mises en forme, ligne « Total » en bas. */
export function versTableSpec(t: TableauRapport, sousTitre?: string): TableSpec {
  const colonnes: Colonne[] = t.entete.map((header, i) => ({ header, width: t.largeurs[i] ?? "auto", align: t.droite.includes(i) ? "right" : "left" }));
  const lignes: Cellule[][] = t.lignes.map((l) => t.entete.map((h, i) => celluleRapportPdf(h, l[i])));
  if (t.sommables?.length) {
    const tot: Cellule[] = new Array(t.entete.length).fill("");
    tot[0] = "Total";
    for (const ci of t.sommables) tot[ci] = celluleRapportPdf(t.entete[ci], somme(t.lignes, ci));
    lignes.push(tot);
  }
  return { sousTitre, colonnes, lignes, totalDerniereLigne: !!t.sommables?.length };
}
