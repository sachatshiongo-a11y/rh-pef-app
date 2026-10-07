import { cleTexte, propre, type CelluleXlsx } from "@/lib/xlsx-leger";
import { texteCellule, type FeuilleGabarit, type Gabarit, indexColonne } from "./gabarit";

// SQUELETTE d'une feuille du gabarit : le rôle de chaque rangée du classeur de la Direction.
//
// Les LIGNES (un plat, une boisson, un article) et leur clé (rubrique, nom) viennent des lecteurs
// d'import (lib/classeur-ventes, lib/classeur-commande) appliqués au gabarit lui-même : le
// document du jour se cale donc sur exactement les mêmes clés que celles posées par le geste
// « Importer les lignes du classeur » (libellé de vente, nom court, rubrique). Le reste se lit sur
// la mise en page, comme le font ces lecteurs :
//  - l'EN-TÊTE est la rangée de la cellule « Désignation… » (et la rangée fusionnée sous elle) ;
//  - une RUBRIQUE est en gras (rapport) ou surlignée comme les rangées « Commande | Livraison »
//    (commande ; « 1. Viande Rouge » numérotée est une sous-rubrique) ;
//  - un EN-TÊTE RÉPÉTÉ (feuille Bar du rapport : « Lundi … Samedi » puis « Designation/Date ») ouvre
//    une nouvelle page imprimée ;
//  - une rangée VIDE encadrée (sous « Supplément ») est une ligne laissée pour écrire à la main ;
//  - un INTITULÉ est une rangée de texte qui n'est pas une ligne de vente (« Vin blanc maison »,
//    au-dessus de ses formats « Verre », « Pichet 1/4 »…).

export type GenreRangee = "titre" | "entete" | "rubrique" | "ligne" | "intitule" | "vide" | "enteteRepete" | "hors";

/** Ligne du classeur telle que l'import la lit : rubrique et nom, rangée de la feuille. */
export type LigneModele = { rubrique: string; nom: string; ligne?: number };

/**
 * Un bloc = une rubrique et ce qui la suit jusqu'à la suivante. `cle` : la rubrique telle que
 * l'import la nomme (celle de ses lignes ; à défaut, le texte de la rangée de rubrique).
 */
export type Bloc = { cle: string; rangeeRubrique: number; lignes: number[]; vides: number[]; derniere: number };

export type Squelette = {
  colDesignation: number;
  /** Colonnes du tableau après la désignation (jours, ou Unité | Commande | Livraison). */
  colsDonnees: number[];
  ligneEntete: number;
  finEntete: number;
  debutCorps: number;
  finCorps: number;
  genres: Map<number, GenreRangee>;
  /** Clé (rubrique, nom) de chaque rangée « ligne ». */
  cles: Map<number, { rubrique: string; nom: string }>;
  blocs: Bloc[];
  /** Rangées servant de modèle aux rangées ajoutées (rubrique, ligne). */
  modeleRubrique: number | null;
  modeleLigne: number | null;
  /** Groupes de rangées d'en-tête répétées dans le corps, dans l'ordre. */
  entetesRepetes: number[][];
};

const estSousRubrique = (t: string) => /^\d+\s*\.\s*\S/.test(t);

/**
 * Squelette d'une feuille. `cellules` : la feuille lue par lib/xlsx-leger (gras, fond) ;
 * `lignes` : les lignes que l'import lit dans cette feuille ; `type` : règle des rubriques.
 */
export function squelette(g: Gabarit, f: FeuilleGabarit, cellules: CelluleXlsx[][], lignes: LigneModele[], type: "RAPPORT" | "COMMANDE"): Squelette {
  const rangee = new Map(f.rangees.map((r) => [r.r, r]));
  const parLigne = new Map<number, CelluleXlsx[]>();
  for (const cs of cellules) if (cs[0]) parLigne.set(cs[0].ligne, cs);

  // En-tête : la cellule « Désignation… ».
  const tete = cellules.find((cs) => cs.some((c) => c.texte && cleTexte(c.texte).startsWith("designation")));
  if (!tete) throw new Error(`Gabarit « ${f.nom} » : aucune cellule « Désignation ».`);
  const cDesignation = tete.find((c) => c.texte && cleTexte(c.texte).startsWith("designation"))!;
  const colDesignation = indexColonne(cDesignation.col);
  const ligneEntete = cDesignation.ligne;
  const fusion = f.fusions.find((z) => z.c1 === colDesignation && z.r1 === ligneEntete);
  const finEntete = fusion?.r2 ?? ligneEntete;
  const colsDonnees = tete.filter((c) => c.texte && indexColonne(c.col) > colDesignation).map((c) => indexColonne(c.col)).sort((a, b) => a - b);

  // Corps : jusqu'à la dernière rangée encadrée (ou écrite) de la colonne des désignations,
  // dans la zone d'impression.
  const borne = f.zone?.r2 ?? Math.max(...f.rangees.map((r) => r.r));
  const designation = (r: number) => rangee.get(r)?.cellules.find((c) => c.col === colDesignation);
  const encadree = (r: number) => {
    const c = designation(r);
    if (!c) return false;
    const b = g.styles.cellules[c.s]?.bordure;
    return !!(b && (b.gauche || b.droite || b.haut || b.bas)) || !!propre(texteCellule(c, g.partages) ?? "");
  };
  let finCorps = finEntete;
  for (const r of f.rangees) if (r.r > finEntete && r.r <= borne && encadree(r.r)) finCorps = r.r;

  // Rubriques de la commande : fonds des rangées qui portent « Commande » à côté de la désignation.
  const aCommande = (cs: CelluleXlsx[]) => cs.some((c) => indexColonne(c.col) !== colDesignation && c.texte && cleTexte(c.texte) === "commande");
  const fonds = new Set<number>();
  if (type === "COMMANDE") {
    for (const cs of cellules) {
      const d = cs.find((c) => indexColonne(c.col) === colDesignation);
      if (d?.texte && d.ligne > finEntete && aCommande(cs)) fonds.add(d.fond);
    }
    fonds.delete(0);
  }

  const cles = new Map<number, { rubrique: string; nom: string }>();
  for (const l of lignes) if (l.ligne !== undefined) cles.set(l.ligne, { rubrique: l.rubrique, nom: l.nom });

  const genres = new Map<number, GenreRangee>();
  for (const r of f.rangees) genres.set(r.r, r.r < ligneEntete ? "titre" : r.r <= finEntete ? "entete" : r.r > finCorps ? "hors" : "intitule");
  const entetesRepetes: number[][] = [];
  const blocs: Bloc[] = [];
  let bloc: Bloc | null = null;
  let modeleRubrique: number | null = null;
  for (let r = finEntete + 1; r <= finCorps; r++) {
    const cs = parLigne.get(r) ?? [];
    const d = cs.find((c) => indexColonne(c.col) === colDesignation);
    const texte = d?.texte ? propre(d.texte) : "";
    const suivante = parLigne.get(r + 1)?.find((c) => indexColonne(c.col) === colDesignation)?.texte ?? "";
    let genre: GenreRangee;
    if (cles.has(r)) genre = "ligne";
    else if (texte && cleTexte(texte).startsWith("designation")) genre = "enteteRepete";
    else if (!texte && cs.some((c) => c.texte) && cleTexte(suivante).startsWith("designation")) genre = "enteteRepete";
    else if (!texte) genre = rangee.has(r) && encadree(r) ? "vide" : "hors";
    else if (type === "RAPPORT" ? d!.gras : aCommande(cs) || fonds.has(d!.fond) || estSousRubrique(texte)) genre = "rubrique";
    else genre = "intitule";
    if (!rangee.has(r)) continue; // rangée absente du classeur : rien à écrire ni à imprimer
    genres.set(r, genre);

    if (genre === "enteteRepete") {
      const dernier = entetesRepetes.at(-1);
      if (dernier && dernier.at(-1) === r - 1) dernier.push(r);
      else entetesRepetes.push([r]);
      bloc = null;
      continue;
    }
    if (genre === "rubrique") {
      bloc = { cle: texte, rangeeRubrique: r, lignes: [], vides: [], derniere: r };
      blocs.push(bloc);
      if (!estSousRubrique(texte)) modeleRubrique = r;
      continue;
    }
    if (!bloc) continue;
    bloc.derniere = r;
    if (genre === "ligne") {
      if (bloc.lignes.length === 0) bloc.cle = cles.get(r)!.rubrique;
      bloc.lignes.push(r);
      bloc.vides = []; // seules les rangées vides qui FERMENT le bloc sont des lignes à écrire
    } else if (genre === "vide") bloc.vides.push(r);
    else bloc.vides = [];
  }
  const modeleLigne = [...cles.keys()].sort((a, b) => a - b)[0] ?? null;
  return { colDesignation, colsDonnees, ligneEntete, finEntete, debutCorps: finEntete + 1, finCorps, genres, cles, blocs, modeleRubrique, modeleLigne, entetesRepetes };
}
