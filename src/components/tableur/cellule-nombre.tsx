"use client";

// Case numérique des tableurs intégrés, « comme Excel » — UN composant pour toutes les grilles
// de saisie de l'application (commande journalière, stock restaurant, inventaire, effectifs…).
//
//  - Champ TEXTE (`inputMode="decimal"` : pavé numérique sur mobile), jamais un champ « number » :
//    pas de flèches d'incrément, et ni la molette ni ↑/↓ ne changent une valeur.
//  - Saisie à la française (« 2,5 », « 1 250 ») lue par `lireSaisieNombre` ; une saisie illisible
//    n'est jamais enregistrée : la case est signalée et, à la sortie, la valeur précédente revient.
//  - Entrée ↓, Maj+Entrée ↑, Tab →, Maj+Tab ←, flèches (← → seulement au bord du texte), Échap
//    annule la frappe ; à l'arrivée, le contenu est sélectionné pour que la frappe le remplace.
//  - Collage d'un bloc Excel à partir de la case active.
//  - Case NON CONTRÔLÉE : une frappe ne provoque aucun rendu React. L'enregistrement part à la
//    sortie de la case (jamais par frappe), et seulement si la valeur a changé ; son état
//    (en cours, échec) ne re-rend que cette case.
//
// La navigation ne connaît pas la grille : elle relit, au moment de la touche, les cases
// présentes dans le DOM sous la racine `data-tableur` (à défaut, le <table> englobant). L'ordre
// suivi est donc toujours l'ordre VISIBLE — filtre et tri compris ; les lignes d'en-tête (sans
// case) et les lignes masquées par l'attribut `hidden` sont sautées d'elles-mêmes.

import { memo, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ecrireSaisieNombre } from "@/lib/nombre";
import { estErreur, messageDe } from "@/lib/action-lisible";
import {
  analyserCollage, ciblesCollage, decisionSortie, deplacer, estCollageMultiple, intentionClavier,
  type Deplacement, type Position, type Regles,
} from "./navigation";
import { suivi } from "./suivi";

/** Attribut à poser sur l'élément qui contient une grille (souvent le <table>). */
export const ATTR_TABLEUR = "data-tableur";
/**
 * Sur la racine : `data-tableur-tab="natif"` laisse Tab au navigateur. Pour les tableaux où les
 * cases numériques côtoient des champs texte ou des listes (catalogue) : Tab visite alors TOUS
 * les champs de la ligne, dans l'ordre de la page, au lieu de sauter d'une case numérique à l'autre.
 */
export const ATTR_TAB_NATIF = "data-tableur-tab";

const EVT_COLLER = "tableur:coller";

/** Case enregistrée : sa position, et la valeur qu'elle avait avant (pour défaire un affichage optimiste). */
export type ContexteCase = { ligne: string; col: number; precedente: number | null };
/**
 * Enregistre la valeur d'une case (null = case vidée). Un échec — promesse rejetée, ou résultat
 * `{ erreur }` d'une action « lisible » — est affiché sur la case, jamais avalé.
 */
export type Enregistreur = (valeur: number | null, contexte: ContexteCase) => unknown;

type Props = Regles & {
  /** Identifiant de la ligne (unique dans la grille) et indice de colonne : position de la case. */
  ligne: string;
  col: number;
  /** Valeur connue du serveur. Si elle change, la case l'adopte (sauf pendant une frappe dans la case). */
  valeur: number | null;
  onEnregistrer: Enregistreur;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  name?: string;
  title?: string;
  "aria-label"?: string;
};

type Etat = { type: "ok" } | { type: "enCours" } | { type: "erreur" | "invalide"; message: string };
const OK: Etat = { type: "ok" };

// ── Lecture de la grille dans le DOM ────────────────────────────────────────
function racineDe(el: HTMLElement): HTMLElement | null {
  return el.closest<HTMLElement>(`[${ATTR_TABLEUR}]`) ?? el.closest("table");
}

function lireGrille(racine: HTMLElement) {
  const indexLigne = new Map<string, number>();
  const grille: boolean[][] = [];
  const cases: HTMLInputElement[][] = [];
  for (const el of racine.querySelectorAll<HTMLInputElement>("input[data-tableur-col]")) {
    if (el.closest("[hidden]")) continue; // ligne masquée par un filtre
    const cle = el.dataset.tableurLigne ?? "";
    let l = indexLigne.get(cle);
    if (l === undefined) {
      l = grille.length;
      indexLigne.set(cle, l);
      grille.push([]);
      cases.push([]);
    }
    const c = Number(el.dataset.tableurCol);
    grille[l][c] = !el.disabled && !el.readOnly;
    cases[l][c] = el;
  }
  for (const ligne of grille) for (let c = 0; c < ligne.length; c++) ligne[c] = ligne[c] === true; // trous → faux
  return { grille, cases };
}

function positionDe(cases: HTMLInputElement[][], el: HTMLInputElement): Position | null {
  for (let l = 0; l < cases.length; l++) {
    const c = cases[l].indexOf(el);
    if (c >= 0) return { l, c };
  }
  return null;
}

function voisine(el: HTMLInputElement, vers: Deplacement): HTMLInputElement | null {
  const racine = racineDe(el);
  if (!racine) return null;
  const { grille, cases } = lireGrille(racine);
  const p = positionDe(cases, el);
  const cible = p && deplacer(grille, p, vers);
  return cible ? cases[cible.l][cible.c] : null;
}

// ── La case ─────────────────────────────────────────────────────────────────
export const CelluleNombre = memo(function CelluleNombre({
  ligne, col, valeur, onEnregistrer, min, max, entier,
  disabled, className, placeholder, name, title, "aria-label": ariaLabel,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  /** Dernière valeur tenue pour enregistrée (serveur, ou envoi réussi / en cours). */
  const enregistree = useRef<number | null>(valeur);
  /** Envois de CETTE case, l'un après l'autre : le dernier tapé est le dernier écrit. */
  const file = useRef<Promise<void>>(Promise.resolve());
  const selectionAuClic = useRef(false);
  const [etat, setEtatBrut] = useState<Etat>(OK);
  const etatRef = useRef<Etat>(OK);
  const monte = useRef(true);

  const poserEtat = (e: Etat) => {
    const etaitErreur = etatRef.current.type === "erreur";
    const estErreurMaintenant = e.type === "erreur";
    if (monte.current && etaitErreur !== estErreurMaintenant) suivi.erreur(estErreurMaintenant);
    etatRef.current = e;
    if (monte.current) setEtatBrut(e);
  };

  /** Valide le texte de la case : enregistre s'il le faut. Renvoie la décision prise. */
  const valider = (texte: string) => {
    const el = ref.current;
    const d = decisionSortie(texte, enregistree.current, { min, max, entier });
    if (d.type === "invalide") {
      poserEtat({ type: "invalide", message: d.message });
      return d;
    }
    if (d.type === "inchange") {
      if (el) el.value = ecrireSaisieNombre(enregistree.current); // « 2,50 » → « 2,5 »
      // Revenue à la valeur enregistrée : plus rien d'illisible ni en attente.
      if (etatRef.current.type === "invalide" || etatRef.current.type === "erreur") poserEtat(OK);
      return d;
    }
    const v = d.valeur;
    const precedente = enregistree.current;
    enregistree.current = v;
    if (el) el.value = ecrireSaisieNombre(v);
    poserEtat({ type: "enCours" });
    const contexte: ContexteCase = { ligne, col, precedente };
    const enregistrer = onEnregistrer;
    suivi.debut();
    file.current = file.current.then(async () => {
      try {
        const r = await enregistrer(v, contexte);
        if (estErreur(r)) throw new Error(r.erreur);
        if (enregistree.current === v) poserEtat(OK);
      } catch (e) {
        // La case redevient « à enregistrer » : repasser dans la case et valider réessaie.
        if (enregistree.current === v) enregistree.current = precedente;
        poserEtat({ type: "erreur", message: `Non enregistré : ${messageDe(e)} Revenez dans la case et validez pour réessayer.` });
      } finally {
        suivi.fin();
      }
    });
    return d;
  };

  // Sortie de case avec une saisie illisible : la valeur précédente revient, la case reste signalée.
  const validerOuRetablir = (el: HTMLInputElement, origine: "sortie" | "collage") => {
    const texte = el.value;
    const d = valider(texte);
    if (d.type === "invalide") {
      el.value = ecrireSaisieNombre(enregistree.current);
      poserEtat({
        type: "invalide",
        message: `${origine === "collage" ? "Collage refusé" : "Saisie refusée"} (« ${texte.trim()} ») : ${d.message} Valeur précédente rétablie.`,
      });
    }
  };

  // Valeur venue du serveur : adoptée, sauf pendant un envoi ou un échec (la case garde alors ce
  // qui a été tapé) ; si l'on est en train de taper dans la case, seul Échap y reviendra.
  useEffect(() => {
    if (etatRef.current.type === "enCours" || etatRef.current.type === "erreur") return;
    enregistree.current = valeur;
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = ecrireSaisieNombre(valeur);
  }, [valeur]);

  // Collage multi-cases : chaque case visée reçoit son texte et passe par la même validation.
  const coller = useRef<(texte: string) => void>(() => {});
  useLayoutEffect(() => {
    coller.current = (texte: string) => {
      const el = ref.current;
      if (!el) return;
      el.value = texte;
      validerOuRetablir(el, "collage");
    };
  });
  useEffect(() => {
    const el = ref.current;
    monte.current = true;
    const surCollage = (ev: Event) => coller.current((ev as CustomEvent<string>).detail);
    el?.addEventListener(EVT_COLLER, surCollage);
    return () => {
      el?.removeEventListener(EVT_COLLER, surCollage);
      if (etatRef.current.type === "erreur") suivi.erreur(false);
      monte.current = false;
    };
  }, []);

  const onFocus = (e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select(); // la frappe remplace le contenu, comme Excel
    selectionAuClic.current = true;
  };
  // Safari désélectionne au relâchement du clic qui a donné le focus : on garde la sélection.
  const onMouseUp = (e: MouseEvent<HTMLInputElement>) => {
    if (selectionAuClic.current) e.preventDefault();
    selectionAuClic.current = false;
  };
  const onBlur = (e: FocusEvent<HTMLInputElement>) => {
    selectionAuClic.current = false;
    validerOuRetablir(e.currentTarget, "sortie");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    selectionAuClic.current = false;
    const el = e.currentTarget;
    const it = intentionClavier(
      { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing },
      { debut: el.selectionStart, fin: el.selectionEnd, longueur: el.value.length }
    );
    if (!it) return;
    if (it.type === "annuler") {
      e.preventDefault();
      el.value = ecrireSaisieNombre(enregistree.current);
      if (etatRef.current.type === "invalide") poserEtat(OK);
      el.select();
      return;
    }
    if (e.key === "Tab" && racineDe(el)?.getAttribute(ATTR_TAB_NATIF) === "natif") return;
    // Entrée et Tab valident : une saisie illisible retient la case (rien n'est perdu ; Échap rétablit).
    if (e.key === "Enter" || e.key === "Tab") {
      const d = decisionSortie(el.value, enregistree.current, { min, max, entier });
      if (d.type === "invalide") {
        e.preventDefault();
        poserEtat({ type: "invalide", message: d.message });
        el.select();
        return;
      }
    }
    const cible = voisine(el, it.vers);
    if (cible) {
      e.preventDefault();
      cible.focus({ preventScroll: true }); // la sortie de la case (blur) enregistre
      // « nearest » + la marge de défilement de la case : l'en-tête et le pied de tableau figés
      // (sticky) ne recouvrent pas la case d'arrivée.
      cible.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      return;
    }
    if (it.auBord === "rester") {
      e.preventDefault(); // Entrée n'envoie jamais le formulaire englobant
      if (e.key === "Enter") {
        validerOuRetablir(el, "sortie");
        el.select();
      }
    }
    // Tab au bout de la grille : le navigateur passe au champ suivant ; la sortie enregistre.
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const bloc = analyserCollage(e.clipboardData.getData("text/plain"));
    if (!estCollageMultiple(bloc)) return; // une seule valeur : collage ordinaire dans la case
    const el = e.currentTarget;
    const racine = racineDe(el);
    if (!racine) return;
    e.preventDefault();
    const { grille, cases } = lireGrille(racine);
    const p = positionDe(cases, el);
    if (!p) return;
    for (const t of ciblesCollage(grille, p, bloc)) cases[t.l][t.c].dispatchEvent(new CustomEvent(EVT_COLLER, { detail: t.texte }));
    el.select();
  };

  const signale = etat.type === "erreur" || etat.type === "invalide";
  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      data-tableur-ligne={ligne}
      data-tableur-col={col}
      data-etat={etat.type}
      name={name}
      defaultValue={ecrireSaisieNombre(valeur)}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={signale || undefined}
      aria-busy={etat.type === "enCours" || undefined}
      title={signale ? etat.message : title}
      onFocus={onFocus}
      onMouseUp={onMouseUp}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={`scroll-my-12 ${className ?? ""} ${etat.type === "enCours" ? "text-muted-foreground" : ""} ${signale ? "!border-destructive bg-destructive/10 text-destructive" : ""}`}
    />
  );
});
