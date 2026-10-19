import { formaterNombre } from "@/lib/montant";
import { estFormatDate, texteCellule, type Ancre, type Gabarit, type StyleCellule, type Zone } from "./gabarit";
import type { GenreRangee } from "./squelette";
import type { Contenu, FeuilleSortie } from "./remplir";

// Ce que l'IMPRESSION d'une feuille remplie lit, et rien d'autre, sous une forme TRANSPORTABLE
// (JSON) : textes déjà résolus, fusions déjà ramenées aux rangées du document, logo en base64.
// Le PDF se rend de ce document-là sur le serveur (lib/modeles-journaliers, pdfModele) comme dans le
// navigateur (lib/pdf/navigateur) : ./impression ne connaît que lui, les deux ne peuvent pas diverger.

export type CelluleImprimable = { col: number; s: number; texte: string; nombre: boolean };
export type RangeeImprimable = { r: number; hauteur: number | null; genre: GenreRangee; cellules: CelluleImprimable[] };
export type ColonneImprimable = { min: number; max: number; largeur: number };

export type FeuilleImprimable = {
  /** Colonnes du document (le dimanche ajouté compris) ; `colonnesGabarit` : celles du classeur (ancrage du logo). */
  colonnes: ColonneImprimable[];
  colonnesGabarit: ColonneImprimable[];
  largeurDefaut: number;
  hauteurDefaut: number;
  /** Fusions, en rangées du document. */
  fusions: Zone[];
  marges: { gauche: number; droite: number; haut: number; bas: number };
  echelle: number | null;
  pagesEnHauteur: number | null;
  paysage: boolean;
  logo: { ancre: Ancre; png: string } | null;
  squelette: { ligneEntete: number; finEntete: number; debutCorps: number };
  rangees: RangeeImprimable[];
  zone: Zone | null;
  entetesRepetes: number[][];
};

export type DocumentImprimable = { titre: string; pied?: string; styles: StyleCellule[]; feuilles: FeuilleImprimable[] };

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Date Excel (numéro de série) → texte, au format de la case (« 28-sept. » pour « d-mmm »). */
function texteDate(serie: number, format: string): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serie) * 86_400_000);
  const j = d.getUTCDate(), m = d.getUTCMonth();
  const f = format.replace(/\[[^\]]*\]/g, "").replace(/;.*$/, "");
  if (/mmm/i.test(f) && !/y/i.test(f)) return `${j}-${MOIS_COURTS[m]}`;
  return `${String(j).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Texte imprimé d'une cellule. Nombres par `formaterNombre` (jamais d'espace fine U+202F, absente d'Optima). */
export function texteImprime(c: Contenu, st: StyleCellule | undefined, g: Pick<Gabarit, "partages">): string {
  const format = st?.format ?? "General";
  const nombre = (n: number) => (estFormatDate(format) ? texteDate(n, format) : formaterNombre(n, { maximumFractionDigits: 3 }));
  switch (c.genre) {
    case "vide": return "";
    case "texte": return c.texte;
    case "nombre": return formaterNombre(c.valeur, { maximumFractionDigits: 3 }); // quantité : jamais au format date
    case "formule": return typeof c.cache === "number" ? nombre(c.cache) : c.cache;
    case "brut": {
      const t = texteCellule(c.cellule, g.partages);
      if (t !== null) return t;
      if (c.cellule.v === null || c.cellule.t === "b" || c.cellule.t === "e") return "";
      const n = Number(c.cellule.v);
      return Number.isFinite(n) ? nombre(n) : c.cellule.v;
    }
  }
}

const base64 = (octets: Uint8Array) => Buffer.from(octets).toString("base64");

/** Une feuille remplie → ce que l'impression en lit. `null` : feuille sans tableau, qui n'imprime rien. */
export function feuilleImprimable(g: Gabarit, f: FeuilleSortie): FeuilleImprimable | null {
  if (!f.squelette) return null;
  const gf = f.gabarit;
  const png = gf.dessin ? g.parties.get(gf.dessin.media) : undefined;
  const colonne = ({ min, max, largeur }: ColonneImprimable) => ({ min, max, largeur });
  return {
    colonnes: f.colonnes.map(colonne),
    colonnesGabarit: gf.colonnes.map(colonne),
    largeurDefaut: gf.largeurDefaut,
    hauteurDefaut: gf.hauteurDefaut,
    fusions: gf.fusions.map((z) => ({ c1: z.c1, c2: z.c2, r1: f.nouvelleLigne(z.r1), r2: f.nouvelleLigne(z.r2) })),
    marges: gf.marges,
    echelle: gf.echelle,
    pagesEnHauteur: gf.pagesEnHauteur,
    paysage: gf.paysage,
    logo: gf.dessin && png ? { ancre: gf.dessin.ancre, png: base64(png) } : null,
    squelette: { ligneEntete: f.squelette.ligneEntete, finEntete: f.squelette.finEntete, debutCorps: f.squelette.debutCorps },
    // Les rangées sous la zone d'impression n'impriment rien (le classeur Cuisine en garde des centaines, mises en forme).
    rangees: f.rangees.filter((x) => !f.zone || x.r <= f.zone.r2).map((x) => ({
      r: x.r,
      hauteur: x.hauteur,
      genre: x.genre,
      cellules: x.cellules.map((c) => ({ col: c.col, s: c.s, texte: texteImprime(c.contenu, g.styles.cellules[c.s], g), nombre: c.contenu.genre === "nombre" })),
    })),
    zone: f.zone,
    entetesRepetes: f.entetesRepetes,
  };
}

/** Le document à imprimer : les feuilles dans l'ordre (celles sans tableau écartées), `pied` sous la dernière. */
export function documentImprimable(g: Gabarit, feuilles: FeuilleSortie[], titre: string, pied?: string): DocumentImprimable {
  return {
    titre,
    ...(pied ? { pied } : {}),
    styles: g.styles.cellules,
    feuilles: feuilles.map((f) => feuilleImprimable(g, f)).filter((f): f is FeuilleImprimable => f !== null),
  };
}
