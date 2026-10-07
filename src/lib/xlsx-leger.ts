import JSZip from "jszip";
import { normTexte } from "@/lib/texte";

// Lecture LÉGÈRE d'un classeur .xlsx (archive zip) pour les imports de la Direction (classeurs
// « Rapport journalier cuisine et bar » et « Commande journalière ») : on ne décompresse QUE le
// classeur, ses liens, les textes partagés, les styles et les feuilles demandées — jamais les
// images (le classeur des ventes de PEF pèse 25 Mo à cause d'un logo TIFF). Utilisable dans le
// navigateur comme sur le serveur. Ne lève jamais : un refus revient en `{ ok: false, erreur }`.

/** Taille maximale acceptée (le plus lourd des classeurs de PEF fait 25 Mo, logo compris). */
export const TAILLE_MAX_CLASSEUR = 60 * 1024 * 1024;

export const propre = (s: string) => s.replace(/\s+/g, " ").trim();
export const cleTexte = (s: string) => normTexte(propre(s));

/**
 * Cellule lue : colonne (« B »), texte (null pour un nombre, une date, une case vide), gras, fond,
 * et `nombre` : la valeur numérique d'une cellule nombre — y compris le RÉSULTAT d'une formule
 * (valeur en cache du classeur), null sinon. Une date Excel est un nombre : à l'appelant de savoir.
 * `ligne` : numéro de la rangée dans la feuille (1 = première ligne d'Excel).
 */
export type CelluleXlsx = { col: string; ligne: number; texte: string | null; gras: boolean; fond: number; nombre: number | null };
/** `feuilles` : clé = nom NORMALISÉ ; `noms` : clé normalisée → nom tel qu'écrit sur l'onglet. */
export type LectureXlsx = { ok: true; feuilles: Map<string, CelluleXlsx[][]>; noms: Map<string, string> } | { ok: false; erreur: string };

export const ILLISIBLE = "Fichier illisible : un classeur Excel (.xlsx) est attendu.";

function decoder(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function attributs(balise: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of balise.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = decoder(m[2]!);
  return out;
}

/** Texte d'un <si> ou d'un <is> : tous les <t> bout à bout (texte enrichi), sans la phonétique. */
const texteRiche = (xml: string) =>
  decoder([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

const lettres = (ref: string) => ref.replace(/\d+$/, "");

async function lireFichier(zip: JSZip, chemin: string): Promise<string | null> {
  const f = zip.file(chemin);
  return f ? f.async("string") : null;
}

/**
 * Lit les feuilles choisies par `garder(nomNormalisé)` (nom sans accents, casse ni espaces
 * superflus). Rend, pour chacune, ses rangées de cellules dans l'ordre du classeur.
 */
export async function lireFeuillesXlsx(donnees: ArrayBuffer | Uint8Array, garder: (nom: string) => boolean): Promise<LectureXlsx> {
  if (donnees.byteLength > TAILLE_MAX_CLASSEUR) return { ok: false, erreur: "Fichier trop lourd (plus de 60 Mo) : ce n'est pas le classeur attendu." };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(donnees);
  } catch {
    return { ok: false, erreur: ILLISIBLE };
  }
  const classeur = await lireFichier(zip, "xl/workbook.xml");
  const liens = await lireFichier(zip, "xl/_rels/workbook.xml.rels");
  if (!classeur || !liens) return { ok: false, erreur: ILLISIBLE };

  const cibles = new Map<string, string>();
  for (const m of liens.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attributs(m[0]);
    if (a.Id && a.Target) cibles.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const chemins = new Map<string, string>(); // nom normalisé → chemin
  const noms = new Map<string, string>(); // nom normalisé → nom de l'onglet
  for (const m of classeur.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attributs(m[0]);
    const chemin = cibles.get(a["r:id"] ?? "");
    if (!a.name || !chemin || !garder(cleTexte(a.name))) continue;
    // Deux onglets de même nom normalisé (« Pina colada » / « Piña colada ») : le second reçoit
    // un suffixe au lieu d'écraser le premier en silence.
    let cle = cleTexte(a.name);
    for (let n = 2; chemins.has(cle); n++) cle = `${cleTexte(a.name)} (${n})`;
    chemins.set(cle, chemin); noms.set(cle, a.name);
  }

  const partages = [...((await lireFichier(zip, "xl/sharedStrings.xml")) ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texteRiche(m[1]!));
  // Styles : style de cellule → police (gras ?) et fond.
  const styles = (await lireFichier(zip, "xl/styles.xml")) ?? "";
  const blocPolices = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)?.[1] ?? "";
  const policesGras = [...blocPolices.matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)].map((m) => {
    const b = /<b\b([^>]*)\/?>/.exec(m[1] ?? "");
    return !!b && !/val="(0|false)"/.test(b[1] ?? "");
  });
  const blocXf = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  const xfs = [...blocXf.matchAll(/<xf\b[^>]*>/g)].map((m) => attributs(m[0]));

  const feuilles = new Map<string, CelluleXlsx[][]>();
  for (const [nom, chemin] of chemins) {
    const xml = await lireFichier(zip, chemin);
    if (!xml) continue;
    const rangees: CelluleXlsx[][] = [];
    let precedente = 0;
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      // `r` est facultatif dans le format : à défaut, la rangée suit la précédente.
      const ligne = Number(attributs(r[1] ?? "").r ?? precedente + 1);
      precedente = ligne;
      const cellules: CelluleXlsx[] = [];
      for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = attributs(c[1]!);
        const contenu = c[2] ?? "";
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(contenu)?.[1]; // <v xml:space="preserve"> compris
        const texte = a.t === "s" ? (v !== undefined ? partages[Number(v)] ?? null : null)
          : a.t === "inlineStr" ? texteRiche(contenu)
          : a.t === "str" && v !== undefined ? decoder(v)
          : null; // nombre, date, vide : jamais une désignation
        // Nombre : cellule sans type (ou « n »), valeur en cache comprise (formule). Jamais un booléen
        // (« b »), une erreur (« e ») ni un texte.
        const n = (a.t === undefined || a.t === "n") && v !== undefined && v.trim() !== "" ? Number(v) : NaN;
        const xf = xfs[Number(a.s ?? 0)] ?? {};
        cellules.push({
          col: lettres(a.r ?? ""),
          ligne,
          texte: texte !== null && propre(texte) ? propre(texte) : null,
          gras: policesGras[Number(xf.fontId ?? 0)] ?? false,
          fond: Number(xf.fillId ?? 0),
          nombre: Number.isFinite(n) ? n : null,
        });
      }
      rangees.push(cellules);
    }
    feuilles.set(nom, rangees);
  }
  return { ok: true, feuilles, noms };
}

/** Colonne des désignations et index de la rangée d'en-tête (cellule qui commence par « Désignation »). */
export function colonneDesignation(rangees: CelluleXlsx[][]): { col: string; entete: number } | null {
  const entete = rangees.findIndex((cs) => cs.some((c) => c.texte && cleTexte(c.texte).startsWith("designation")));
  if (entete < 0) return null;
  return { col: rangees[entete]!.find((c) => c.texte && cleTexte(c.texte).startsWith("designation"))!.col, entete };
}
