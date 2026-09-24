// Tableurs intégrés « comme Excel » — logique PURE (sans DOM, sans React), testée à part.
//
// La grille est vue comme une matrice de cases navigables : une LIGNE par ligne de saisie
// VISIBLE (les lignes d'en-tête de catégorie n'ont pas de case, elles n'existent donc pas ici ;
// les lignes masquées par un filtre non plus), une COLONNE par indice de colonne de saisie.
// `grille[l][c]` vaut vrai si la case existe et accepte la saisie (ni désactivée ni en lecture
// seule). Les lignes peuvent être de longueurs différentes : une case absente vaut faux.

import { lireSaisieNombre } from "@/lib/nombre";

export type Position = { l: number; c: number };
export type Grille = ReadonlyArray<ReadonlyArray<boolean>>;

/** bas/haut = Entrée/Maj+Entrée et ↓/↑ ; droite/gauche = → et ← ; suivante/précédente = Tab/Maj+Tab. */
export type Deplacement = "bas" | "haut" | "droite" | "gauche" | "suivante" | "precedente";

const ok = (g: Grille, l: number, c: number) => g[l]?.[c] === true;

/** Case d'arrivée d'un déplacement, en sautant les cases non navigables ; null au bord de la grille. */
export function deplacer(g: Grille, p: Position, d: Deplacement): Position | null {
  switch (d) {
    case "bas":
      for (let l = p.l + 1; l < g.length; l++) if (ok(g, l, p.c)) return { l, c: p.c };
      return null;
    case "haut":
      for (let l = p.l - 1; l >= 0; l--) if (ok(g, l, p.c)) return { l, c: p.c };
      return null;
    case "droite":
      for (let c = p.c + 1; c < (g[p.l]?.length ?? 0); c++) if (ok(g, p.l, c)) return { l: p.l, c };
      return null;
    case "gauche":
      for (let c = p.c - 1; c >= 0; c--) if (ok(g, p.l, c)) return { l: p.l, c };
      return null;
    case "suivante": {
      const memeLigne = deplacer(g, p, "droite");
      if (memeLigne) return memeLigne;
      for (let l = p.l + 1; l < g.length; l++)
        for (let c = 0; c < g[l].length; c++) if (ok(g, l, c)) return { l, c };
      return null;
    }
    case "precedente": {
      const memeLigne = deplacer(g, p, "gauche");
      if (memeLigne) return memeLigne;
      for (let l = p.l - 1; l >= 0; l--)
        for (let c = g[l].length - 1; c >= 0; c--) if (ok(g, l, c)) return { l, c };
      return null;
    }
  }
}

/** Touche pressée, telle que la voit le gestionnaire clavier. */
export type Touche = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** Composition en cours (clavier asiatique, accents morts) : on ne touche à rien. */
  isComposing?: boolean;
};
/** Position du curseur dans le texte de la case (selectionStart / selectionEnd). */
export type Curseur = { debut: number | null; fin: number | null; longueur: number };

/**
 * Ce que fait une touche :
 *  - `deplacer` : aller vers une case voisine. `auBord` dit quoi faire s'il n'y en a pas :
 *    « rester » (on valide et on reste dans la case, comme Excel au bas de la feuille) ou
 *    « sortir » (Tab en fin de grille : le navigateur passe au champ suivant de la page) ;
 *  - `annuler` : Échap, la frappe en cours est abandonnée ;
 *  - null : comportement normal du champ (frappe, sélection au clavier, raccourcis).
 */
export type Intention =
  | { type: "deplacer"; vers: Deplacement; auBord: "rester" | "sortir" }
  | { type: "annuler" }
  | null;

export function intentionClavier(t: Touche, curseur: Curseur): Intention {
  if (t.isComposing) return null;
  if (t.ctrlKey || t.metaKey || t.altKey) return null; // raccourcis (copier, coller, annuler…) : intacts
  const debut = curseur.debut ?? 0;
  const fin = curseur.fin ?? curseur.longueur;
  switch (t.key) {
    case "Enter":
      return { type: "deplacer", vers: t.shiftKey ? "haut" : "bas", auBord: "rester" };
    case "Tab":
      return { type: "deplacer", vers: t.shiftKey ? "precedente" : "suivante", auBord: "sortir" };
    case "Escape":
      return { type: "annuler" };
    case "ArrowDown":
    case "ArrowUp":
      if (t.shiftKey) return null;
      return { type: "deplacer", vers: t.key === "ArrowDown" ? "bas" : "haut", auBord: "rester" };
    case "ArrowLeft":
      // Curseur au début du texte, ou texte entièrement sélectionné (à l'arrivée dans la case,
      // comme en mode « Entrer » d'Excel) : on change de case. Sinon ← déplace le curseur.
      if (t.shiftKey) return null;
      return debut === 0 && (fin === 0 || fin === curseur.longueur)
        ? { type: "deplacer", vers: "gauche", auBord: "rester" }
        : null;
    case "ArrowRight":
      if (t.shiftKey) return null;
      return fin === curseur.longueur && (debut === curseur.longueur || debut === 0)
        ? { type: "deplacer", vers: "droite", auBord: "rester" }
        : null;
    default:
      return null;
  }
}

/** Règles d'une case numérique (bornes incluses). */
export type Regles = { min?: number; max?: number; entier?: boolean };

export type Decision =
  | { type: "inchange" }
  | { type: "enregistrer"; valeur: number | null }
  | { type: "invalide"; message: string };

const egales = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-9;

/**
 * Que faire du texte d'une case quand on la quitte (ou qu'on valide) : rien s'il désigne la
 * valeur déjà enregistrée (« 2,50 » = 2,5 : pas d'aller-retour serveur pour rien), l'enregistrer
 * s'il est lisible et dans les bornes, sinon le refuser avec un message. Vide = effacer.
 */
export function decisionSortie(texte: string, enregistree: number | null, regles: Regles = {}): Decision {
  const lu = lireSaisieNombre(texte);
  if (!lu.ok) return { type: "invalide", message: `« ${texte.trim()} » n'est pas un nombre.` };
  const v = lu.valeur;
  if (v !== null) {
    if (regles.entier && !Number.isInteger(v)) return { type: "invalide", message: "Nombre entier attendu." };
    if (regles.min !== undefined && v < regles.min) return { type: "invalide", message: `Minimum : ${regles.min}.` };
    if (regles.max !== undefined && v > regles.max) return { type: "invalide", message: `Maximum : ${regles.max}.` };
  }
  return egales(v, enregistree) ? { type: "inchange" } : { type: "enregistrer", valeur: v };
}

/**
 * Découpe un bloc copié depuis Excel (ou Google Sheets, ou un tableau de cette application) :
 * lignes séparées par des retours à la ligne, colonnes par des tabulations. Le retour à la ligne
 * final qu'Excel ajoute toujours ne crée pas de ligne vide.
 */
export function analyserCollage(texte: string): string[][] {
  const lignes = texte.replace(/\r\n?/g, "\n").split("\n");
  if (lignes.length > 1 && lignes[lignes.length - 1] === "") lignes.pop();
  return lignes.map((l) => l.split("\t"));
}

/** Vrai si le bloc couvre plus d'une case (sinon, collage ordinaire dans la case). */
export const estCollageMultiple = (bloc: string[][]) => bloc.length > 1 || (bloc[0]?.length ?? 0) > 1;

/**
 * Cases remplies par un collage à partir de la case active : la case (l + i, c + j) reçoit
 * bloc[i][j]. Ce qui dépasse la grille est ignoré ; une case désactivée garde sa valeur (la
 * valeur collée n'est pas décalée sur la voisine, pour que chaque nombre tombe sous sa colonne).
 */
export function ciblesCollage(g: Grille, depart: Position, bloc: string[][]): { l: number; c: number; texte: string }[] {
  const cibles: { l: number; c: number; texte: string }[] = [];
  bloc.forEach((ligne, i) =>
    ligne.forEach((texte, j) => {
      const l = depart.l + i, c = depart.c + j;
      if (ok(g, l, c)) cibles.push({ l, c, texte });
    })
  );
  return cibles;
}
