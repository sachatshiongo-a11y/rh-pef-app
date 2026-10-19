import type { StyleCellule } from "@/lib/modeles-journaliers/gabarit";
import type { CelluleImprimable, DocumentImprimable, FeuilleImprimable, RangeeImprimable } from "@/lib/modeles-journaliers/imprimable";

/**
 * Ce qu'une route envoie au NAVIGATEUR pour qu'il fabrique un PDF lui-même (./rendre) : les documents
 * à imprimer, un par partie (un jour de la semaine), la police Optima en base64 et le nom du fichier.
 * L'instance gratuite n'a qu'un dixième de processeur : la semaine de commande y prenait 2 à 3 minutes,
 * contre quelques secondes sur l'appareil de la personne.
 *
 * Forme COMPACTE pour le transport (la semaine passait à 6,8 Mo) : le logo et les styles, identiques
 * d'un jour à l'autre, ne voyagent qu'une fois ; une case est un tableau court (la plupart sont
 * vides, seulement bordées). `compacterDonnees` (serveur) et `partieImprimable` (navigateur) sont
 * l'aller et le retour exacts, vérifiés par test.
 */
export type PolicesOptima = { regular: string; bold: string; italic: string; boldItalic: string };

/** [colonne, style] — [colonne, style, texte] — [colonne, style, texte, 1] (nombre, aligné à droite). */
export type CelluleCompacte = [number, number] | [number, number, string] | [number, number, string, 1];
type RangeeCompacte = Omit<RangeeImprimable, "cellules"> & { c: CelluleCompacte[] };
type FeuilleCompacte = Omit<FeuilleImprimable, "rangees" | "logo"> & { rangees: RangeeCompacte[]; logo: { ancre: NonNullable<FeuilleImprimable["logo"]>["ancre"]; image: number } | null };
type PartieCompacte = { titre: string; pied?: string; styles: number; feuilles: FeuilleCompacte[] };

export type DonneesPdfNavigateur = {
  fichier: string;
  polices: PolicesOptima;
  /** Images (PNG en base64) et jeux de styles, une seule fois chacun. */
  images: string[];
  styles: StyleCellule[][];
  parties: PartieCompacte[];
};

function compacterCellule(c: CelluleImprimable): CelluleCompacte {
  if (c.nombre) return [c.col, c.s, c.texte, 1];
  return c.texte ? [c.col, c.s, c.texte] : [c.col, c.s];
}

/** Serveur : les documents à imprimer → la forme transportée. */
export function compacterDonnees(fichier: string, polices: PolicesOptima, docs: DocumentImprimable[]): DonneesPdfNavigateur {
  const images: string[] = [];
  const styles: StyleCellule[][] = [];
  const clesStyles: string[] = [];
  const indexImage = (png: string) => { const i = images.indexOf(png); return i >= 0 ? i : images.push(png) - 1; };
  const indexStyles = (st: StyleCellule[]) => {
    const cle = JSON.stringify(st);
    const i = clesStyles.indexOf(cle);
    if (i >= 0) return i;
    clesStyles.push(cle);
    return styles.push(st) - 1;
  };
  const parties = docs.map((d): PartieCompacte => ({
    titre: d.titre,
    ...(d.pied ? { pied: d.pied } : {}),
    styles: indexStyles(d.styles),
    feuilles: d.feuilles.map(({ rangees, logo, ...reste }) => ({
      ...reste,
      logo: logo ? { ancre: logo.ancre, image: indexImage(logo.png) } : null,
      rangees: rangees.map(({ cellules, ...r }) => ({ ...r, c: cellules.map(compacterCellule) })),
    })),
  }));
  return { fichier, polices, images, styles, parties };
}

/** Navigateur : la partie `i` telle que l'impression la lit. */
export function partieImprimable(d: DonneesPdfNavigateur, i: number): DocumentImprimable {
  const p = d.parties[i]!;
  return {
    titre: p.titre,
    ...(p.pied ? { pied: p.pied } : {}),
    styles: d.styles[p.styles]!,
    feuilles: p.feuilles.map(({ rangees, logo, ...reste }) => ({
      ...reste,
      logo: logo ? { ancre: logo.ancre, png: d.images[logo.image]! } : null,
      rangees: rangees.map(({ c, ...r }) => ({
        ...r,
        cellules: c.map(([col, s, texte, nombre]) => ({ col, s, texte: texte ?? "", nombre: nombre === 1 })),
      })),
    })),
  };
}

/** Contrôle de forme de la réponse, avant d'y engager le rendu (références comprises). Fonction PURE. */
export function donneesPdfValides(x: unknown): x is DonneesPdfNavigateur {
  if (!x || typeof x !== "object") return false;
  const d = x as Partial<DonneesPdfNavigateur>;
  const p = d.polices as Partial<PolicesOptima> | undefined;
  if (typeof d.fichier !== "string" || !d.fichier) return false;
  if (!p || ![p.regular, p.bold, p.italic, p.boldItalic].every((v) => typeof v === "string" && v.length > 0)) return false;
  if (!Array.isArray(d.images) || !Array.isArray(d.styles) || !Array.isArray(d.parties) || d.parties.length === 0) return false;
  const images = d.images.length, styles = d.styles;
  return d.parties.every((doc) => !!doc && typeof doc.titre === "string"
    && Number.isInteger(doc.styles) && Array.isArray(styles[doc.styles])
    && Array.isArray(doc.feuilles) && doc.feuilles.length > 0
    && doc.feuilles.every((f) => !!f && Array.isArray(f.rangees) && (f.logo === null || (Number.isInteger(f.logo?.image) && f.logo!.image < images))));
}
