import { cleTexte, propre } from "@/lib/xlsx-leger";
import { cleLegume } from "@/lib/classeur-commande";
import type { ValeurFiche } from "@/lib/fiches-conso";
import { estFormatDate, recrireReferences, texteCellule, type CelluleBrute, type FeuilleGabarit, type Gabarit, type RangeeBrute, type Zone } from "./gabarit";
import type { GenreRangee, Squelette } from "./squelette";

// REMPLISSAGE d'une feuille du gabarit avec les données du jour : le résultat (`FeuilleSortie`) est
// la feuille du classeur de la Direction, rangée pour rangée, où seules changent :
//  - les cases de données (nombre vendu, commandé, livré ; unité de l'article) des lignes que
//    l'application connaît ;
//  - la date et la semaine de l'en-tête ;
//  - les lignes de l'application ABSENTES du classeur, jamais perdues : à la fin de leur rubrique
//    (dans les lignes laissées vides pour écrire à la main, s'il y en a), ou — rubrique inconnue du
//    classeur — dans une rubrique ajoutée à la fin de la feuille ;
//  - le dimanche, ajouté en colonne quand il porte une vente (rapport).
// Une ligne du classeur que l'application n'a pas reste présente, ses cases vides.
//
// Fonction PURE : ni disque, ni base. L'Excel (./classeur) et le PDF (./impression) lisent la même
// `FeuilleSortie` — ils ne peuvent pas diverger.

export type Contenu =
  | { genre: "brut"; cellule: CelluleBrute }
  | { genre: "vide" }
  | { genre: "texte"; texte: string }
  | { genre: "nombre"; valeur: number }
  | { genre: "formule"; formule: string; cache: number | string };

export type CelluleSortie = { col: number; s: number; contenu: Contenu };

export type RangeeSortie = {
  r: number;
  attributs: string;
  hauteur: number | null;
  genre: GenreRangee;
  cellules: CelluleSortie[];
  /** Ligne de l'application écrite sur cette rangée (rangée du classeur ou ajoutée). */
  donnees?: boolean;
};

export type FeuilleSortie = {
  nom: string;
  gabarit: FeuilleGabarit;
  /** null : feuille recopiée telle quelle (« Fiche commande Salle », vide). */
  squelette: Squelette | null;
  rangees: RangeeSortie[];
  /** Rangée du gabarit → rangée du document (lignes insérées). */
  nouvelleLigne: (r: number) => number;
  colonnes: FeuilleGabarit["colonnes"];
  colsDonnees: number[];
  zone: Zone | null;
  /** Groupes d'en-têtes répétés, en rangées du document. */
  entetesRepetes: number[][];
  /** Lignes de l'application absentes du classeur, et où elles ont été mises (pour le contrôle). */
  ajouts: { libelle: string; rubrique: string; rubriqueAjoutee: boolean }[];
  /**
   * Lignes posées sur une rangée du classeur par leur NOM seul (rubrique différente dans
   * l'application) : jamais une perte, mais un rattachement à savoir (pour le contrôle).
   */
  rattacheesParNom: { libelle: string; rubrique: string; rubriqueClasseur: string }[];
};

/** Une ligne de l'application à placer sur la feuille. */
export type LigneDonnees = {
  /** Rubrique de la ligne dans l'application (catégorie, rubrique de la fiche commande). */
  rubrique: string;
  /** Noms sous lesquels la ligne peut figurer dans le classeur (libellé importé, nom court, désignation). */
  noms: string[];
  /** Légume frais (liste des légumes) : rapproché sans pluriel ni ponctuation, dans sa rubrique seulement. */
  legume?: boolean;
  /** Libellé imprimé quand la ligne n'est pas dans le classeur. */
  libelle: string;
  /** Mention ajoutée au libellé du classeur quand la ligne y trouve sa rangée (« (désactivé) »). */
  mention?: string;
  /** Une valeur par colonne de données, dans l'ordre (cf. `ValeurFiche`). */
  valeurs: ValeurFiche[];
};

export type DonneesFeuille = {
  /** Nom d'onglet (celui du classeur par défaut). */
  nom?: string;
  lignes: LigneDonnees[];
  semaine: number;
  /** Rapport : lundi de la semaine (AAAA-MM-JJ) — dates de l'en-tête. */
  lundi?: string;
  /** Rapport : le dimanche porte une vente → 7e colonne. */
  dimanche?: boolean;
  /** Commande : le jour (AAAA-MM-JJ), écrit sous « Date : ». */
  date?: string;
};

export const RUBRIQUE_LEGUMES_CLE = cleTexte("Fruits & Légumes frais");
const JOUR_SUIVANT: Record<string, string> = { sam: "Dim", samedi: "Dimanche" };

/** Numéro de série Excel d'une date pure (AAAA-MM-JJ). */
export const serieExcel = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

const dateCourte = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Contenu d'une valeur de l'application : nombre, texte, « — » (inconnu), rien (""). */
function contenuValeur(v: ValeurFiche): Contenu {
  if (v === null) return { genre: "texte", texte: "—" };
  if (typeof v === "number") return { genre: "nombre", valeur: v };
  return v.trim() ? { genre: "texte", texte: v } : { genre: "vide" };
}

/** Valeur numérique d'une cellule brute (valeur ou résultat en cache), null sinon. */
function nombreBrut(c: CelluleBrute): number | null {
  if (c.t !== null && c.t !== "n") return null;
  if (c.v === null || c.v.trim() === "") return null;
  const n = Number(c.v);
  return Number.isFinite(n) ? n : null;
}

const copieRangee = (r: RangeeBrute, genre: GenreRangee): RangeeSortie => ({
  r: r.r, attributs: r.attributs, hauteur: r.hauteur, genre,
  cellules: r.cellules.map((c) => ({ col: c.col, s: c.s, contenu: { genre: "brut", cellule: c } })),
});

export function remplirFeuille(g: Gabarit, f: FeuilleGabarit, sq: Squelette, d: DonneesFeuille): FeuilleSortie {
  const source = new Map(f.rangees.map((r) => [r.r, r]));
  const cellule = (r: RangeeSortie, col: number) => r.cellules.find((c) => c.col === col);
  const ecrire = (r: RangeeSortie, col: number, contenu: Contenu, s?: number) => {
    const c = cellule(r, col);
    if (c) { c.contenu = contenu; if (s !== undefined) c.s = s; }
    else { r.cellules.push({ col, s: s ?? 0, contenu }); r.cellules.sort((a, b) => a.col - b.col); }
  };
  const texteDe = (c: CelluleSortie | undefined) =>
    !c ? null : c.contenu.genre === "brut" ? texteCellule(c.contenu.cellule, g.partages) : c.contenu.genre === "texte" ? c.contenu.texte : null;

  // ── 1. Rapprochement des lignes de l'application avec celles du classeur ──
  const libres = new Map(sq.cles);
  const place = new Map<LigneDonnees, number>();
  const memeNom = (l: LigneDonnees, cle: { rubrique: string; nom: string }) =>
    l.legume
      ? cleTexte(cle.rubrique) === RUBRIQUE_LEGUMES_CLE && l.noms.some((n) => cleLegume(n) === cleLegume(cle.nom))
      : l.noms.some((n) => cleTexte(n) === cleTexte(cle.nom));
  // D'abord nom ET rubrique ; puis le nom seul, s'il ne désigne qu'UNE ligne restante du classeur.
  const rattacheesParNom: FeuilleSortie["rattacheesParNom"] = [];
  for (const exige of [true, false]) {
    for (const l of d.lignes) {
      if (place.has(l)) continue;
      const candidates = [...libres].filter(([, cle]) => memeNom(l, cle) && (!exige || cleTexte(cle.rubrique) === cleTexte(l.rubrique)));
      if (candidates.length === 0 || (!exige && candidates.length > 1)) continue;
      place.set(l, candidates[0]![0]);
      libres.delete(candidates[0]![0]);
      if (!exige) rattacheesParNom.push({ libelle: l.libelle, rubrique: l.rubrique, rubriqueClasseur: candidates[0]![1].rubrique });
    }
  }

  // ── 2. Rangées du document : celles du classeur, dans l'ordre ──
  const lignesSortie = new Map<number, RangeeSortie>();
  for (const r of f.rangees) lignesSortie.set(r.r, copieRangee(r, sq.genres.get(r.r) ?? "hors"));

  const cloner = (modele: number, genre: GenreRangee): RangeeSortie => copieRangee(source.get(modele)!, genre);
  /** Ligne ajoutée : la rangée `modele` (styles, hauteur), vidée, avec le libellé de l'application. */
  const rangeeLigne = (modele: number, l: LigneDonnees): RangeeSortie => {
    const n = cloner(modele, "ligne");
    for (const c of n.cellules) c.contenu = { genre: "vide" };
    ecrire(n, sq.colDesignation, { genre: "texte", texte: l.libelle });
    return n;
  };

  // ── 3. Lignes absentes du classeur : dans leur rubrique, sinon une rubrique ajoutée ──
  const insertions = new Map<number, RangeeSortie[]>(); // après la rangée du gabarit → rangées ajoutées
  const inserer = (apres: number, r: RangeeSortie) => {
    const liste = insertions.get(apres) ?? [];
    liste.push(r);
    insertions.set(apres, liste);
  };
  const ajouts: FeuilleSortie["ajouts"] = [];
  const restantes = d.lignes.filter((l) => !place.has(l));
  const groupes = new Map<string, LigneDonnees[]>();
  for (const l of restantes) {
    const k = cleTexte(l.legume ? "Fruits & Légumes frais" : l.rubrique);
    groupes.set(k, [...(groupes.get(k) ?? []), l]);
  }
  const ecritureLigne = new Map<RangeeSortie, LigneDonnees>();
  const nouvelles: [string, LigneDonnees[]][] = [];
  for (const [k, ls] of groupes) {
    const bloc = [...sq.blocs].reverse().find((b) => cleTexte(b.cle) === k);
    if (!bloc) { nouvelles.push([k, ls]); continue; }
    const modele = bloc.lignes.at(-1) ?? sq.modeleLigne!;
    const vides = [...bloc.vides];
    let apres = vides.length ? vides[0]! - 1 : bloc.derniere;
    for (const l of ls) {
      const v = vides.shift();
      if (v !== undefined) {
        // Une ligne laissée vide pour écrire à la main reçoit la ligne (au style d'une ligne).
        const r = rangeeLigne(modele, l);
        lignesSortie.set(v, r);
        ecritureLigne.set(r, l);
        apres = v;
      } else {
        const r = rangeeLigne(modele, l);
        inserer(apres, r);
        ecritureLigne.set(r, l);
      }
      ajouts.push({ libelle: l.libelle, rubrique: l.rubrique, rubriqueAjoutee: false });
    }
  }
  for (const [, ls] of nouvelles) {
    // Rubrique inconnue du classeur : une rangée de rubrique (comme celles du classeur) à la fin.
    const titre = ls[0]!.legume ? "Fruits & Légumes frais" : propre(ls[0]!.rubrique);
    if (sq.modeleRubrique !== null) {
      const rub = cloner(sq.modeleRubrique, "rubrique");
      // On garde les textes fixes de la rangée (« Commande | Livraison »), pas son titre.
      ecrire(rub, sq.colDesignation, { genre: "texte", texte: titre });
      inserer(sq.finCorps, rub);
    }
    for (const l of ls) {
      const r = rangeeLigne(sq.modeleLigne!, l);
      inserer(sq.finCorps, r);
      ecritureLigne.set(r, l);
      ajouts.push({ libelle: l.libelle, rubrique: l.rubrique, rubriqueAjoutee: true });
    }
  }
  for (const [l, r] of place) ecritureLigne.set(lignesSortie.get(r)!, l);

  // ── 4. Numérotation : les rangées ajoutées décalent celles qui suivent ──
  const ancres = [...insertions.keys()].sort((a, b) => a - b);
  const nouvelleLigne = (r: number) => r + ancres.filter((a) => a < r).reduce((n, a) => n + insertions.get(a)!.length, 0);
  const rangees: RangeeSortie[] = [];
  const toutes = [...lignesSortie.keys(), ...ancres].filter((v, i, t) => t.indexOf(v) === i).sort((a, b) => a - b);
  for (const r of toutes) {
    const s = lignesSortie.get(r);
    if (s) { s.r = nouvelleLigne(r); rangees.push(s); }
    const ins = insertions.get(r);
    if (ins) ins.forEach((x, i) => { x.r = nouvelleLigne(r) + 1 + i; rangees.push(x); });
  }
  rangees.sort((a, b) => a.r - b.r);
  // Zone d'impression : décalée comme ses rangées, et prolongée jusqu'aux rangées ajoutées en fin de feuille.
  const finAjouts = Math.max(0, ...(insertions.get(sq.finCorps) ?? []).map((x) => x.r));
  const zone = f.zone ? { ...f.zone, r2: Math.max(nouvelleLigne(f.zone.r2), finAjouts) } : null;
  const parNumero = new Map(rangees.map((x) => [x.r, x]));

  // ── 5. En-tête : dates de la semaine, numéro de semaine, date du jour ──
  const enTete = rangees.filter((x) => x.genre === "titre" || x.genre === "entete" || x.genre === "enteteRepete");
  const formatDe = (s: number) => g.styles.cellules[s]?.format ?? "General";
  if (d.lundi) {
    const litterale = enTete.flatMap((x) => x.cellules).find((c) => c.contenu.genre === "brut" && !c.contenu.cellule.formule && estFormatDate(formatDe(c.s)) && nombreBrut(c.contenu.cellule) !== null);
    const lundiModele = litterale && litterale.contenu.genre === "brut" ? nombreBrut(litterale.contenu.cellule)! : null;
    if (lundiModele !== null) {
      const ecart = serieExcel(d.lundi) - lundiModele;
      for (const c of enTete.flatMap((x) => x.cellules)) {
        if (c.contenu.genre !== "brut" || !estFormatDate(formatDe(c.s))) continue;
        const v = nombreBrut(c.contenu.cellule);
        if (v === null) continue;
        // La date reste une date du classeur (même cellule, même style) : seule sa valeur change.
        c.contenu = c.contenu.cellule.formule
          ? { genre: "formule", formule: c.contenu.cellule.formule, cache: v + ecart }
          : { genre: "brut", cellule: { ...c.contenu.cellule, v: String(v + ecart) } };
      }
    }
  }
  for (const x of rangees.filter((y) => y.genre === "titre" || y.genre === "entete")) {
    for (const c of x.cellules) {
      const t = propre(texteDe(c) ?? "");
      if (cleTexte(t) === "semaine") {
        // La case à droite de « Semaine » : le numéro ISO (celui de l'application, lundi → dimanche).
        const voisine = x.cellules.find((v) => v.col > c.col);
        if (!voisine) continue;
        const brute = voisine.contenu.genre === "brut" ? voisine.contenu.cellule : null;
        const arg = brute?.formule ? /WEEKNUM\(\s*([^,)]+)/i.exec(brute.formule)?.[1] : undefined;
        voisine.contenu = arg ? { genre: "formule", formule: `WEEKNUM(${arg.trim()},21)`, cache: d.semaine } : { genre: "nombre", valeur: d.semaine };
      } else if (d.date && /^date\s*:/.test(cleTexte(t))) {
        // Sous « Date : », la date du jour (la case du classeur garde son texte, comme imprimé).
        const r = x.r + 1;
        let dessous = parNumero.get(r);
        if (!dessous) {
          dessous = { r, attributs: "", hauteur: null, genre: "titre", cellules: [] };
          rangees.push(dessous);
          rangees.sort((a, b) => a.r - b.r);
          parNumero.set(r, dessous);
        }
        ecrire(dessous, c.col, { genre: "texte", texte: dateCourte(d.date) }, c.s);
      }
    }
  }

  // ── 6. Dimanche (rapport) : une colonne de plus, comme la dernière ──
  const colsDonnees = [...sq.colsDonnees];
  let colonnes = f.colonnes.map((c) => ({ ...c }));
  let zoneFinale = zone;
  if (d.dimanche && colsDonnees.length >= 2) {
    const dernier = colsDonnees.at(-1)!, avant = colsDonnees.at(-2)!;
    const nouveau = dernier + 1;
    for (const x of rangees) {
      const c = cellule(x, dernier);
      if (!c) continue;
      const nc: CelluleSortie = { col: nouveau, s: c.s, contenu: decalerContenu(c.contenu, g) };
      const existante = cellule(x, nouveau);
      if (existante) Object.assign(existante, nc);
      else { x.cellules.push(nc); x.cellules.sort((a, b) => a.col - b.col); }
      const precedente = cellule(x, avant);
      if (precedente) c.s = precedente.s;
    }
    colsDonnees.push(nouveau);
    // Largeur : la plus grande des colonnes de jours (« Dimanche » tient comme « Mercredi »).
    const largeur = Math.max(...colsDonnees.map((k) => colonnes.find((c) => c.min <= k && k <= c.max)?.largeur ?? f.largeurDefaut));
    colonnes = fixerLargeur(colonnes, nouveau, largeur);
    if (zoneFinale && zoneFinale.c2 >= dernier) zoneFinale = { ...zoneFinale, c2: zoneFinale.c2 + 1 };
  }

  // ── 7. Données ──
  // Style d'une case de données : UN style par colonne, pris aux lignes du classeur. Ses cases vides
  // portent des formats disparates, invisibles tant qu'elles sont vides (rapport, Bar : « Martini
  // rosé », « Pinsang »… en or gras ou en corps 12 ; commande, Bar : la moitié soulignées) ; un
  // chiffre écrit doit se lire pareil d'une ligne à l'autre. Parmi les styles courants (un quart des
  // lignes au moins), le plus sobre : non souligné, en noir, puis le plus fréquent.
  const styleColonne = new Map<number, number>();
  for (const col of colsDonnees) {
    const compte = new Map<number, number>();
    for (const x of rangees) if (x.genre === "ligne") { const c = cellule(x, col); if (c) compte.set(c.s, (compte.get(c.s) ?? 0) + 1); }
    // Regroupés par ce qui se VOIT d'un chiffre (police, alignement), les bordures pouvant varier.
    const aspect = (st: number) => {
      const c = g.styles.cellules[st];
      return c ? JSON.stringify([c.police, c.horizontal]) : String(st);
    };
    const parAspect = new Map<string, [number, number][]>();
    for (const e of compte) parAspect.set(aspect(e[0]), [...(parAspect.get(aspect(e[0])) ?? []), e]);
    const total = [...compte.values()].reduce((a, b) => a + b, 0);
    const sobre = (st: number) => {
      const p = g.styles.cellules[st]?.police;
      return (p?.souligne ? 2 : 0) + (p && p.couleur !== "#000000" ? 1 : 0);
    };
    const groupes = [...parAspect.values()].map((es) => ({ n: es.reduce((a, e) => a + e[1], 0), s: es.sort((a, b) => b[1] - a[1])[0]![0] }));
    const choix = groupes.filter((x) => x.n >= total / 4).sort((a, b) => sobre(a.s) - sobre(b.s) || b.n - a.n)[0] ?? groupes.sort((a, b) => b.n - a.n)[0];
    if (choix) styleColonne.set(col, choix.s);
  }
  for (const [r, l] of ecritureLigne) {
    l.valeurs.forEach((v, i) => {
      const col = colsDonnees[i];
      if (col !== undefined) ecrire(r, col, contenuValeur(v), styleColonne.get(col));
    });
    if (l.mention && place.has(l)) {
      const d = cellule(r, sq.colDesignation);
      ecrire(r, sq.colDesignation, { genre: "texte", texte: `${propre(texteDe(d) ?? "")}${l.mention}` });
    }
    r.donnees = true;
  }

  return {
    nom: d.nom ?? f.nom,
    gabarit: f,
    squelette: sq,
    rangees,
    nouvelleLigne,
    colonnes,
    colsDonnees,
    zone: zoneFinale,
    entetesRepetes: sq.entetesRepetes.map((gr) => gr.map(nouvelleLigne)),
    ajouts,
    rattacheesParNom,
  };
}

/** Contenu de la colonne du dimanche : celui du samedi, décalé d'une colonne et d'un jour. */
function decalerContenu(c: Contenu, g: Gabarit): Contenu {
  const decaler = (f: string) => recrireReferences(f, (x) => ({ col: x.colAbs ? x.col : x.col + 1, ligne: x.ligne }));
  if (c.genre === "formule") return { genre: "formule", formule: decaler(c.formule), cache: typeof c.cache === "number" ? c.cache + 1 : JOUR_SUIVANT[cleTexte(c.cache)] ?? c.cache };
  if (c.genre === "nombre") return { genre: "nombre", valeur: c.valeur + 1 };
  if (c.genre !== "brut") return { ...c };
  if (!c.cellule.formule && nombreBrut(c.cellule) !== null) return { genre: "brut", cellule: { ...c.cellule, v: String(nombreBrut(c.cellule)! + 1) } };
  const b = c.cellule;
  const texte = texteCellule(b, g.partages);
  if (b.formule) {
    const cache: number | string = texte !== null ? JOUR_SUIVANT[cleTexte(texte)] ?? texte : nombreBrut(b) !== null ? nombreBrut(b)! + 1 : "";
    return { genre: "formule", formule: decaler(b.formule), cache };
  }
  if (texte !== null) return JOUR_SUIVANT[cleTexte(texte)] ? { genre: "texte", texte: JOUR_SUIVANT[cleTexte(texte)]! } : { genre: "vide" };
  const n = nombreBrut(b);
  return n !== null ? { genre: "nombre", valeur: n + 1 } : { genre: "vide" };
}

/** Fixe la largeur d'UNE colonne dans la liste <cols> (en coupant la plage qui la contient). */
function fixerLargeur(colonnes: FeuilleGabarit["colonnes"], col: number, largeur: number): FeuilleGabarit["colonnes"] {
  const sortie: FeuilleGabarit["colonnes"] = [];
  let vue = false;
  for (const c of colonnes) {
    if (c.min <= col && col <= c.max) {
      vue = true;
      if (c.min < col) sortie.push({ ...c, max: col - 1, brut: c.brut.replace(/max="\d+"/, `max="${col - 1}"`) });
      sortie.push({ min: col, max: col, largeur, brut: c.brut.replace(/min="\d+"/, `min="${col}"`).replace(/max="\d+"/, `max="${col}"`).replace(/width="[\d.]+"/, `width="${largeur}"`).replace(/(customWidth="1")?\s*\/>$/, ' customWidth="1"/>') });
      if (col < c.max) sortie.push({ ...c, min: col + 1, brut: c.brut.replace(/min="\d+"/, `min="${col + 1}"`) });
    } else sortie.push(c);
  }
  if (!vue) sortie.push({ min: col, max: col, largeur, brut: `<col min="${col}" max="${col}" width="${largeur}" customWidth="1"/>` });
  return sortie.sort((a, b) => a.min - b.min);
}

/** Feuille recopiée telle quelle (aucune donnée) : « Fiche commande Salle », vide dans le classeur. */
export function feuilleTelleQuelle(f: FeuilleGabarit): FeuilleSortie {
  return {
    nom: f.nom, gabarit: f, squelette: null, rangees: f.rangees.map((r) => copieRangee(r, "hors")), nouvelleLigne: (r) => r,
    colonnes: f.colonnes, colsDonnees: [], zone: f.zone, entetesRepetes: [], ajouts: [], rattacheesParNom: [],
  };
}
