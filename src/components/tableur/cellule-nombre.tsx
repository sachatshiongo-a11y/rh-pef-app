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
//  - Collage d'un bloc Excel à partir de la case active (refusé s'il franchit une catégorie).
//  - Case NON CONTRÔLÉE : une frappe ne provoque aucun rendu React. L'enregistrement part à la
//    sortie de la case (jamais par frappe), et seulement si la valeur a changé ; son état
//    (en cours, échec) ne re-rend que cette case.
//  - Une frappe non validée n'est jamais perdue en silence : la case entre dans le `suivi` dès la
//    frappe, et elle est enregistrée si elle disparaît de l'écran (démontage : filtre, changement
//    de jour…) ou si la page se masque ou se ferme.
//  - Erreurs et refus s'affichent EN TEXTE sous la grille (`ZoneTableur`), avec le libellé de la
//    case — l'infobulle `title` ne s'affiche pas sur un téléphone.
//
// La navigation ne connaît pas la grille : elle relit, au moment de la touche, les cases
// présentes dans le DOM sous la racine `data-tableur` (à défaut, le <table> englobant). L'ordre
// suivi est donc toujours l'ordre VISIBLE — filtre et tri compris ; les lignes d'en-tête (sans
// case) et les lignes masquées par l'attribut `hidden` sont sautées d'elles-mêmes.

import { memo, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ecrireSaisieNombre } from "@/lib/nombre";
import { estErreur, messageDe } from "@/lib/action-lisible";
import {
  analyserCollage, bilanCollage, decisionSortie, deplacer, estCollageMultiple, intentionClavier, planCollage,
  type Decision, type Deplacement, type Position, type Regles, type ResultatCase,
} from "./navigation";
import { suivi } from "./suivi";
import { useSignaleur } from "./messages";

/** Attribut à poser sur l'élément qui contient une grille (souvent le <table>). */
export const ATTR_TABLEUR = "data-tableur";
/**
 * Sur la racine : `data-tableur-tab="natif"` laisse Tab au navigateur. Pour les tableaux où les
 * cases numériques côtoient des champs texte ou des listes (catalogue) : Tab visite alors TOUS
 * les champs de la ligne, dans l'ordre de la page, au lieu de sauter d'une case numérique à l'autre.
 */
export const ATTR_TAB_NATIF = "data-tableur-tab";

const EVT_COLLER = "tableur:coller";
type DetailCollage = { texte: string; resultat: ResultatCase };

/**
 * Case enregistrée : sa position, `precedente` = la dernière valeur CONFIRMÉE par le serveur quand
 * l'envoi part (pour défaire un affichage optimiste — jamais une valeur seulement envoyée), et sa `donnee` telle qu'elle était AU MOMENT DE LA VALIDATION (ex. la date du jour
 * de la colonne : si la semaine affichée change pendant l'envoi, l'écriture va à la bonne date).
 */
export type ContexteCase = { ligne: string; col: number; precedente: number | null; donnee?: string };
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
  /** Donnée figée à la validation et rendue dans le contexte d'enregistrement (ex. date ISO du jour). */
  donnee?: string;
  /** Catégorie de la ligne : un collage ne franchit jamais une catégorie. */
  groupe?: string;
  /**
   * Entrée sur la DERNIÈRE ligne de la grille (formulaires à lignes : bon de commande, facture) :
   * appelé après validation de la case, pour ajouter une ligne comme Excel. Sans lui, on reste.
   */
  onEntreeDerniereLigne?: (cle: { ligne: string; col: number }) => void;
  disabled?: boolean;
  /** Case lisible mais non modifiable (ex. prix fixé au catalogue) : sautée par la navigation. */
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  name?: string;
  title?: string;
  /** Libellé de la case (article et jour) : lu à l'écran et repris dans les messages d'erreur. */
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
  const groupes: (string | undefined)[] = [];
  for (const el of racine.querySelectorAll<HTMLInputElement>("input[data-tableur-col]")) {
    if (el.closest("[hidden]")) continue; // ligne masquée par un filtre
    const cle = el.dataset.tableurLigne ?? "";
    let l = indexLigne.get(cle);
    if (l === undefined) {
      l = grille.length;
      indexLigne.set(cle, l);
      grille.push([]);
      cases.push([]);
      groupes.push(el.dataset.tableurGroupe);
    }
    const c = Number(el.dataset.tableurCol);
    grille[l][c] = !el.disabled && !el.readOnly;
    cases[l][c] = el;
  }
  for (const ligne of grille) for (let c = 0; c < ligne.length; c++) ligne[c] = ligne[c] === true; // trous → faux
  return { grille, cases, groupes };
}

function positionDe(cases: HTMLInputElement[][], el: HTMLInputElement): Position | null {
  for (let l = 0; l < cases.length; l++) {
    const c = cases[l].indexOf(el);
    if (c >= 0) return { l, c };
  }
  return null;
}

function estSurDerniereLigne(el: HTMLInputElement): boolean {
  const racine = racineDe(el);
  if (!racine) return false;
  const { cases } = lireGrille(racine);
  const p = positionDe(cases, el);
  return p !== null && p.l === cases.length - 1;
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
  ligne, col, valeur, onEnregistrer, donnee, groupe, onEntreeDerniereLigne, min, max, entier, quantite,
  disabled, readOnly, className, placeholder, name, title, "aria-label": ariaLabel,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  /** Dernière valeur tenue pour enregistrée (serveur, ou envoi réussi / en cours). */
  const enregistree = useRef<number | null>(valeur);
  /**
   * Dernière valeur CONFIRMÉE par le serveur (valeur d'origine, ou envoi réussi). C'est la seule
   * valeur de repli après un échec : jamais une valeur seulement envoyée. (Avant : 1 en base, 5
   * puis 6 tapés, les deux envois en échec → la case retombait sur 5, jamais enregistré, et
   * retaper 5 effaçait son signal rouge.) `enregistree` ≠ `confirmee` ⇔ un envoi est en attente.
   */
  const confirmee = useRef<number | null>(valeur);
  /** Envois de CETTE case, l'un après l'autre : le dernier tapé est le dernier écrit. */
  const file = useRef<Promise<void>>(Promise.resolve());
  const selectionAuClic = useRef(false);
  const [etat, setEtatBrut] = useState<Etat>(OK);
  const etatRef = useRef<Etat>(OK);
  const monte = useRef(true);
  /** Une frappe n'a pas encore été validée. */
  const modifiee = useRef(false);
  const [jeton] = useState(() => ({}));
  const signaleur = useSignaleur();
  const regles: Regles = { min, max, entier, quantite };
  const cleMessage = `${ligne}|${col}|${donnee ?? ""}`;
  const libelle = ariaLabel ?? `Ligne ${ligne}, colonne ${col + 1}`;

  const poserEtat = (e: Etat) => {
    const etaitErreur = etatRef.current.type === "erreur";
    const estErreurMaintenant = e.type === "erreur";
    if (monte.current && etaitErreur !== estErreurMaintenant) suivi.erreur(estErreurMaintenant);
    etatRef.current = e;
    // La zone de messages reste montée même si la case a disparu : le message y reste.
    signaleur?.signaler(cleMessage, e.type === "erreur" || e.type === "invalide" ? `${libelle} : ${e.message}` : null);
    if (monte.current) setEtatBrut(e);
  };

  const marquerPropre = () => {
    if (!modifiee.current) return;
    modifiee.current = false;
    suivi.propre(jeton);
  };

  /** Valide le texte de la case : enregistre s'il le faut. Renvoie la décision prise. */
  const valider = (el: HTMLInputElement, texte: string): Decision => {
    const d = decisionSortie(texte, enregistree.current, regles);
    if (d.type === "invalide") {
      poserEtat({ type: "invalide", message: d.message });
      return d;
    }
    marquerPropre();
    if (d.type === "inchange") {
      el.value = ecrireSaisieNombre(enregistree.current); // « 2,50 » → « 2,5 »
      // Revenue à la valeur enregistrée : plus rien d'illisible. Le signal d'échec, lui, ne tombe
      // que si cette valeur est CONFIRMÉE par le serveur ; encore en route, la case reste signalée
      // jusqu'à l'issue de son envoi.
      const confirmeeAffichee = enregistree.current === confirmee.current;
      if (etatRef.current.type === "invalide") poserEtat(confirmeeAffichee ? OK : { type: "enCours" });
      else if (etatRef.current.type === "erreur" && confirmeeAffichee) poserEtat(OK);
      return d;
    }
    const v = d.valeur;
    enregistree.current = v;
    el.value = ecrireSaisieNombre(v);
    poserEtat({ type: "enCours" });
    const donneeFigee = donnee; // figée MAINTENANT (ex. le jour de la colonne)
    const enregistrer = onEnregistrer;
    suivi.debut();
    file.current = file.current.then(async () => {
      // `precedente` = la valeur confirmée au moment où CET envoi part (les envois de la case se
      // suivent : l'issue du précédent est connue) — c'est elle que l'appelant rétablit en cas
      // d'échec, jamais une valeur seulement envoyée.
      const contexte: ContexteCase = { ligne, col, precedente: confirmee.current, donnee: donneeFigee };
      try {
        const r = await enregistrer(v, contexte);
        if (estErreur(r)) throw new Error(r.erreur);
        confirmee.current = v;
        if (enregistree.current === v) poserEtat(OK);
      } catch (e) {
        // La case redevient « à enregistrer » : repasser dans la case et valider réessaie. Le
        // repli est la dernière valeur confirmée ; la saisie reste affichée, en rouge.
        if (enregistree.current === v) enregistree.current = confirmee.current;
        poserEtat({ type: "erreur", message: `non enregistré — ${messageDe(e)} Revenez dans la case et validez pour réessayer.` });
      } finally {
        suivi.fin();
      }
    });
    return d;
  };

  // Sortie de case avec une saisie illisible : la valeur précédente revient, la case reste signalée.
  const validerOuRetablir = (el: HTMLInputElement, origine: "sortie" | "collage"): Decision => {
    const texte = el.value;
    const d = valider(el, texte);
    if (d.type === "invalide") {
      el.value = ecrireSaisieNombre(enregistree.current);
      marquerPropre();
      poserEtat({
        type: "invalide",
        message: `${origine === "collage" ? "collage refusé" : "saisie refusée"} (« ${texte.trim()} ») — ${d.message} Valeur précédente rétablie.`,
      });
    }
    return d;
  };

  // Valeur venue du serveur : adoptée, sauf pendant un envoi ou un échec (la case garde alors ce
  // qui a été tapé) ; si l'on est en train de taper dans la case, seul Échap y reviendra.
  useEffect(() => {
    if (etatRef.current.type === "enCours" || etatRef.current.type === "erreur") return;
    enregistree.current = valeur;
    confirmee.current = valeur;
    const el = ref.current;
    if (el && document.activeElement !== el && !modifiee.current) el.value = ecrireSaisieNombre(valeur);
  }, [valeur]);

  // Fonctions du DERNIER rendu, pour les appels hors événement React : collage reçu d'une autre
  // case, page masquée ou fermée, démontage.
  const actions = useRef({
    coller: (_d: DetailCollage) => {},
    validerEnPlace: () => {},
    validerAuDepart: (_el: HTMLInputElement) => {},
  });
  useLayoutEffect(() => {
    actions.current = {
      coller: (detail) => {
        const el = ref.current;
        if (!el) return;
        el.value = detail.texte;
        const d = validerOuRetablir(el, "collage");
        detail.resultat = d.type === "invalide" ? "illisible" : d.type === "inchange" ? "inchangee" : d.ambigu ? "ambigue" : "remplacee";
      },
      // Page masquée ou fermée : on enregistre la frappe en attente. Illisible : la case la garde,
      // signalée (la confirmation avant de quitter reste active).
      validerEnPlace: () => {
        const el = ref.current;
        if (el) valider(el, el.value);
      },
      // Case qui disparaît (filtre, changement de jour, ligne retirée) avec une frappe en attente.
      validerAuDepart: (el) => {
        const texte = el.value;
        const d = valider(el, texte);
        if (d.type === "invalide") {
          marquerPropre();
          poserEtat({ type: "invalide", message: `saisie « ${texte.trim()} » NON enregistrée — ${d.message}` });
        }
      },
    };
  });

  useEffect(() => {
    const el = ref.current;
    monte.current = true;
    const surCollage = (ev: Event) => actions.current.coller((ev as CustomEvent<DetailCollage>).detail);
    el?.addEventListener(EVT_COLLER, surCollage);
    return () => {
      el?.removeEventListener(EVT_COLLER, surCollage);
      if (el && modifiee.current) actions.current.validerAuDepart(el);
      if (etatRef.current.type === "erreur") suivi.erreur(false);
      monte.current = false;
    };
  }, []);

  // La case entre dans le suivi dès la frappe (aucun rendu : rien que des refs).
  const onChange = () => {
    if (modifiee.current) return;
    modifiee.current = true;
    suivi.modifiee(jeton, () => actions.current.validerEnPlace());
  };

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
      marquerPropre();
      if (etatRef.current.type === "invalide") poserEtat(OK);
      el.select();
      return;
    }
    if (e.key === "Tab" && racineDe(el)?.getAttribute(ATTR_TAB_NATIF) === "natif") return;
    // Quitter la case AU CLAVIER (Entrée, Tab, flèches) valide : une saisie illisible retient la
    // case, en rouge avec sa saisie (rien n'est perdu ; Échap rétablit).
    const d = decisionSortie(el.value, enregistree.current, regles);
    if (d.type === "invalide") {
      e.preventDefault();
      poserEtat({ type: "invalide", message: d.message });
      el.select();
      return;
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
        validerOuRetablir(el, "sortie"); // saisie lisible ici : l'illisible a été retenu plus haut
        if (!e.shiftKey && onEntreeDerniereLigne && estSurDerniereLigne(el)) onEntreeDerniereLigne({ ligne, col });
        else el.select();
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
    const { grille, cases, groupes } = lireGrille(racine);
    const p = positionDe(cases, el);
    if (!p) return;
    const plan = planCollage(grille, groupes, p, bloc);
    if (plan.type === "refus") {
      signaleur?.bilan(plan.message);
      return;
    }
    const resultats = plan.cibles.map((t) => {
      const detail: DetailCollage = { texte: t.texte, resultat: "illisible" };
      cases[t.l][t.c].dispatchEvent(new CustomEvent(EVT_COLLER, { detail }));
      return detail.resultat;
    });
    signaleur?.bilan(bilanCollage(plan, resultats));
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
      data-tableur-groupe={groupe}
      data-etat={etat.type}
      name={name}
      defaultValue={ecrireSaisieNombre(valeur)}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={signale || undefined}
      aria-busy={etat.type === "enCours" || undefined}
      title={signale ? etat.message : title}
      onChange={onChange}
      onFocus={onFocus}
      onMouseUp={onMouseUp}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={`scroll-my-12 ${className ?? ""} ${etat.type === "enCours" ? "text-muted-foreground" : ""} ${signale ? "!border-destructive bg-destructive/10 text-destructive" : ""}`}
    />
  );
});
