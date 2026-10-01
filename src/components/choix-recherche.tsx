"use client";

// Choix d'un élément dans une LONGUE liste (articles, fournisseurs, fiches…) en TAPANT son nom :
// le champ d'un <select> qui se cherche au clavier. Remplace les listes déroulantes où il fallait
// défiler 1 000 articles.
//
//  - Combobox accessible (role="combobox" + listbox) : on tape, la liste se filtre (accents et casse
//    ignorés, mots dans le désordre, nom court et code compris — cf. lib/recherche-options).
//  - Liste FERMÉE : Entrée / Maj+Entrée passent au même champ de la ligne d'en-dessous / d'au-dessus
//    (comme Entrée dans une case du tableur) ; Tab est celui du navigateur ; ↑ ↓ (ou Alt+↓) ouvrent
//    la liste. Entrée n'envoie JAMAIS un formulaire.
//  - Liste OUVERTE : ↑ ↓ parcourent, Entrée choisit, Échap ferme (sans rien changer). Tab ne choisit
//    que sans ambiguïté : après ↑ ↓ (même après une frappe), l'option surlignée — une nouvelle frappe
//    remet ce geste à zéro ; sinon, après une frappe, le résultat UNIQUE ou celui
//    dont le libellé est exactement ce qui est tapé ; texte effacé et champ non obligatoire, « aucun ».
//    Sinon Tab ne choisit rien et le champ revient à son choix d'avant (Entrée reste le geste explicite).
//    Un clic ou un appui ailleurs ferme et rétablit le choix d'avant : une frappe sans choix ne change rien.
//  - Même VALEUR qu'un <select> : `value` + `onChange(id)` (contrôlé), ou `defaultValue` (libre) ;
//    avec `name`, un champ caché porte l'id — « » pour « aucun ». Le champ visible n'a jamais de
//    `name` : le texte tapé ne part jamais au serveur. En mode libre, le champ suit la remise à zéro
//    du formulaire (événement `reset`, que React 19 provoque après une action) : il retrouve `defaultValue`.
//  - UNE liste partagée (`options`) : le composant ne la recopie pas ; son index normalisé est
//    mémorisé par identité de tableau. `extras` = options propres à UNE ligne (« Créer… », « Ignorer »,
//    proches), listées en tête. La liste rendue n'existe que tant qu'elle est ouverte, et au plus
//    200 options à la fois (« … N autres : précisez »).
//  - La liste flotte dans un PORTAIL (document.body), positionnée d'après le champ : un tableau qui
//    défile ou un tiroir ne la coupe pas. Elle se place dans la zone VISIBLE (visualViewport : le clavier
//    d'un téléphone la réduit au lieu de la masquer) et passe au-dessus du champ s'il manque de place.
//    Pas de backdrop-filter. Cibles de 44 px sous `lg`.
//
// Non testé sur un vrai appareil : le clavier virtuel et le défilement tactile d'iOS (voir le compte
// rendu du lot) ; le positionnement est vérifié en happy-dom seulement.

import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { filtrerOptions, motsDe, optionParId, type OptionChoix } from "@/lib/recherche-options";
import { normTexte } from "@/lib/texte";

const LIMITE = 200;

type Props = {
  /** Liste partagée (même tableau pour toutes les lignes d'un écran : `useMemo`). */
  options: readonly OptionChoix[];
  /** Options propres à CE champ, listées en tête (« Créer l'article… », « Ignorer », proches). */
  extras?: readonly OptionChoix[];
  /** Mode contrôlé. */
  value?: string;
  /** Mode libre (valeur initiale). */
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** Champ caché soumis avec le formulaire (id choisi, « » pour aucun). */
  name?: string;
  /** Texte de l'option « aucun » (« — libre — ») : listée en tête, affichée en filigrane quand rien n'est choisi. Absent = pas d'option vide. */
  vide?: string;
  placeholder?: string;
  /** Texte montré quand la valeur n'est dans aucune liste (article désactivé depuis, par exemple). */
  libelleInconnu?: string;
  required?: boolean;
  disabled?: boolean;
  /** Classes du champ visible : celles du <select> qu'il remplace (bordure, taille, placement en grille). */
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Nom de colonne d'un tableur : Entrée passe au champ de même colonne de la ligne suivante. Défaut : `name`. */
  colonne?: string;
};

type Place = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/** Champ de même colonne, plus bas (sens 1) ou plus haut (sens -1), dans la même grille. */
function voisinDeColonne(el: HTMLInputElement, sens: 1 | -1): HTMLInputElement | null {
  const racine = el.closest("[data-tableur]") ?? el.closest("table");
  const colonne = el.dataset.choixRecherche;
  if (!racine || !colonne) return null;
  const champs = [...racine.querySelectorAll<HTMLInputElement>("input[data-choix-recherche]")]
    // Hors champs désactivés, lignes masquées par `hidden` et présentations cachées par CSS (table ↔ cartes).
    .filter((x) => x.dataset.choixRecherche === colonne && !x.disabled && !x.closest("[hidden]") && (typeof x.checkVisibility !== "function" || x.checkVisibility()));
  return champs[champs.indexOf(el) + sens] ?? null;
}

export const ChoixRecherche = memo(function ChoixRecherche({
  options, extras, value, defaultValue, onChange, name, vide, placeholder, libelleInconnu = "Hors liste", required, disabled,
  className = "", id, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledby, colonne,
}: Props) {
  const uid = useId();
  const idListe = `${uid}-liste`;
  const champ = useRef<HTMLInputElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const selectionAuClic = useRef(false);
  /** Un appui (souris ou doigt) est en cours DANS la liste : le champ peut perdre le focus sans que la liste se ferme (iOS). */
  const appuiDansListe = useRef(false);
  /** ↑ ↓ ont déplacé la surbrillance depuis l'ouverture (sans frappe) : Tab choisit alors l'option surlignée. */
  const aNavigue = useRef(false);

  const [interne, setInterne] = useState(defaultValue ?? "");
  const valeur = value ?? interne;
  // Dernières valeur et rappel, lisibles depuis l'écoute de `reset` sans la ré-enregistrer à chaque rendu.
  const valeurCourante = useRef(valeur);
  const surChangement = useRef(onChange);
  useEffect(() => { valeurCourante.current = valeur; surChangement.current = onChange; });
  const [ouvert, setOuvert] = useState(false);
  /** Frappe en cours ; null = on montre le libellé du choix. */
  const [saisie, setSaisie] = useState<string | null>(null);
  const [actif, setActif] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  // Région « N résultats » lue par les lecteurs d'écran : montée en permanence (une région vivante
  // annonce ce qui CHANGE, pas ce qui apparaît avec elle), hors du <label> éventuel (portail).
  const [monte, setMonte] = useState(false);
  useEffect(() => { setMonte(true); }, []);

  const optionChoisie = useMemo(
    () => (valeur === "" ? undefined : (extras && optionParId(extras, valeur)) || optionParId(options, valeur)),
    [valeur, options, extras]
  );
  const texte = valeur === "" ? "" : optionChoisie?.libelle ?? libelleInconnu;

  // Options montrées : « aucun » (saisie vide seulement), puis celles de la ligne, puis la liste partagée.
  const { affiches, reste } = useMemo(() => {
    if (!ouvert) return { affiches: [] as OptionChoix[], reste: 0 };
    const requete = saisie ?? "";
    const sansMots = motsDe(requete).length === 0;
    const propres = extras ? filtrerOptions(extras, requete) : [];
    const dejaLa = new Set(propres.map((o) => o.id));
    const communes = filtrerOptions(options, requete).filter((o) => !dejaLa.has(o.id));
    const tout = [...(vide !== undefined && sansMots ? [{ id: "", libelle: vide } as OptionChoix] : []), ...propres, ...communes];
    return { affiches: tout.slice(0, LIMITE), reste: Math.max(0, tout.length - LIMITE) };
  }, [ouvert, saisie, options, extras, vide]);

  const total = affiches.length + reste;
  // Options consécutives d'un même groupe, dans l'ordre (les options sans groupe forment leur propre bloc).
  const blocs = useMemo(() => {
    const l: { groupe: string | undefined; items: { o: OptionChoix; i: number }[] }[] = [];
    affiches.forEach((o, i) => {
      const dernier = l[l.length - 1];
      if (dernier && dernier.groupe === o.groupe) dernier.items.push({ o, i });
      else l.push({ groupe: o.groupe, items: [{ o, i }] });
    });
    return l;
  }, [affiches]);

  const fermer = useCallback(() => { setOuvert(false); setSaisie(null); }, []);
  // Mode libre : la remise à zéro du formulaire (React 19 la provoque après une action) rend le choix
  // initial, comme pour une liste déroulante native ; le champ caché suivrait, l'affichage aussi.
  useEffect(() => {
    const formulaire = champ.current?.form;
    if (!formulaire || value !== undefined) return;
    const raz = () => {
      const initiale = defaultValue ?? "";
      setInterne(initiale);
      fermer();
      if (initiale !== valeurCourante.current) surChangement.current?.(initiale); // le parent (état par ligne…) en est informé
    };
    formulaire.addEventListener("reset", raz);
    return () => formulaire.removeEventListener("reset", raz);
  }, [value, defaultValue, fermer]);
  const choisir = (o: OptionChoix) => {
    if (o.id !== valeur) {
      setInterne(o.id);
      onChange?.(o.id);
    }
    fermer();
  };

  // À l'ouverture : l'option choisie est en surbrillance (la première sinon, et toujours la première
  // quand l'ouverture vient d'une frappe).
  useEffect(() => {
    aNavigue.current = false;
    if (ouvert) setActif(saisie === null ? Math.max(0, affiches.findIndex((o) => o.id === valeur)) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement à l'ouverture
  }, [ouvert]);
  useEffect(() => {
    if (ouvert) document.getElementById(`${uid}-o${actif}`)?.scrollIntoView?.({ block: "nearest" });
  }, [ouvert, actif, uid]);

  // Position de la liste : sous le champ, ou au-dessus s'il manque de place dans la zone VISIBLE
  // (le clavier d'un téléphone réduit visualViewport). Recalculée quand la page défile ou se redimensionne.
  const placer = useCallback(() => {
    const el = champ.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const hautVisible = vv?.offsetTop ?? 0;
    const basVisible = hautVisible + (vv?.height ?? window.innerHeight);
    const gaucheVisible = vv?.offsetLeft ?? 0;
    const largeurVisible = vv?.width ?? window.innerWidth;
    const dessous = basVisible - r.bottom - 6;
    const dessus = r.top - hautVisible - 6;
    const enHaut = dessous < 200 && dessus > dessous;
    const largeur = Math.min(Math.max(r.width, 260), largeurVisible - 16);
    const gauche = Math.min(Math.max(r.left, gaucheVisible + 8), gaucheVisible + largeurVisible - largeur - 8);
    const hauteurMax = Math.max(120, Math.min(enHaut ? dessus : dessous, 352));
    const repere = document.documentElement.clientHeight;
    const p: Place = enHaut
      ? { left: gauche, width: largeur, maxHeight: hauteurMax, bottom: repere - r.top + 4 }
      : { left: gauche, width: largeur, maxHeight: hauteurMax, top: r.bottom + 4 };
    // Défiler la liste elle-même déclenche aussi « scroll » : rien à refaire si la place n'a pas changé.
    setPlace((a) => (a && a.left === p.left && a.width === p.width && a.maxHeight === p.maxHeight && a.top === p.top && a.bottom === p.bottom ? a : p));
  }, []);
  useLayoutEffect(() => {
    if (!ouvert) { setPlace(null); return; }
    placer();
  }, [ouvert, saisie, affiches.length, placer]);
  useEffect(() => {
    if (!ouvert) return;
    const vv = window.visualViewport;
    window.addEventListener("scroll", placer, true);
    window.addEventListener("resize", placer);
    vv?.addEventListener("resize", placer);
    vv?.addEventListener("scroll", placer);
    return () => {
      window.removeEventListener("scroll", placer, true);
      window.removeEventListener("resize", placer);
      vv?.removeEventListener("resize", placer);
      vv?.removeEventListener("scroll", placer);
    };
  }, [ouvert, placer]);

  // Liste ouverte : un appui hors du champ et de la liste la ferme (le doigt sur une page qui ne donne
  // pas le focus ailleurs n'envoie pas toujours « blur »). Un appui DANS la liste est suivi, pour que la
  // perte de focus qui l'accompagne parfois (Safari iOS) ne la ferme pas avant le choix.
  useEffect(() => {
    if (!ouvert) return;
    let fin: ReturnType<typeof setTimeout> | undefined;
    const dehors = (e: Event) => {
      const cible = e.target as Node | null;
      if (liste.current?.contains(cible) || champ.current?.contains(cible)) return;
      fermer();
    };
    const relache = () => { clearTimeout(fin); fin = setTimeout(() => { appuiDansListe.current = false; }, 600); };
    document.addEventListener("pointerdown", dehors, true);
    document.addEventListener("pointerup", relache, true);
    document.addEventListener("pointercancel", relache, true);
    return () => {
      clearTimeout(fin);
      appuiDansListe.current = false;
      document.removeEventListener("pointerdown", dehors, true);
      document.removeEventListener("pointerup", relache, true);
      document.removeEventListener("pointercancel", relache, true);
    };
  }, [ouvert, fermer]);

  /** Ce que Tab choisit, liste ouverte : voir l'en-tête du fichier. */
  const choixAuTab = (): OptionChoix | null => {
    // ↑ ↓ ont déplacé la surbrillance (une frappe ensuite remet ce geste à zéro) : c'est elle qui compte.
    if (aNavigue.current) return affiches[actif] ?? null;
    if (saisie === null) return null;
    const tape = saisie.replace(/\s+/g, " ").trim();
    if (tape === "") return vide !== undefined && !required ? { id: "", libelle: vide } : null;
    const exacte = affiches.find((o) => o.id !== "" && normTexte(o.libelle).replace(/\s+/g, " ").trim() === normTexte(tape));
    if (exacte) return exacte;
    return affiches.length === 1 && reste === 0 && affiches[0].id !== "" ? affiches[0] : null; // jamais « aucun » par ce chemin
  };

  const surClavier = (e: KeyboardEvent<HTMLInputElement>) => {
    selectionAuClic.current = false;
    if (e.nativeEvent.isComposing) return;
    const n = affiches.length;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        if (!ouvert) setOuvert(true);
        else if (!e.altKey && n > 0) { aNavigue.current = true; setActif((a) => (e.key === "ArrowDown" ? Math.min(a + 1, n - 1) : Math.max(a - 1, 0))); }
        return;
      case "Enter":
        e.preventDefault(); // jamais d'envoi du formulaire par Entrée
        if (ouvert) {
          if (affiches[actif]) choisir(affiches[actif]);
        } else {
          const voisin = voisinDeColonne(e.currentTarget, e.shiftKey ? -1 : 1);
          if (voisin) { voisin.focus({ preventScroll: true }); voisin.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }
        }
        return;
      case "Escape":
        if (ouvert) { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopPropagation(); fermer(); } // ni fenêtre ni tiroir ne se ferme avec
        return;
      case "Tab": {
        if (!ouvert) return;
        // Tab ne choisit que sans ambiguïté ; sinon la liste se ferme et le choix d'avant revient.
        const cible = choixAuTab();
        if (cible) choisir(cible); else fermer();
        return;
      }
    }
  };

  const surSaisie = (v: string) => {
    // Première frappe sur le libellé affiché (la sélection a pu sauter) : on ne garde que ce qui est tapé en plus.
    const brut = saisie === null && texte !== "" && v.length > texte.length && v.startsWith(texte) ? v.slice(texte.length) : v;
    aNavigue.current = false;
    setSaisie(brut);
    setActif(0);
    setOuvert(true);
  };

  const surFocus = (e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select(); // la frappe remplace le libellé
    selectionAuClic.current = true;
  };
  const surMouseUp = (e: MouseEvent<HTMLInputElement>) => {
    if (selectionAuClic.current) e.preventDefault(); // Safari désélectionne au relâchement du clic qui donne le focus
    selectionAuClic.current = false;
  };
  const surBlur = (e: FocusEvent<HTMLInputElement>) => {
    selectionAuClic.current = false;
    if (appuiDansListe.current || liste.current?.contains(e.relatedTarget as Node | null)) return;
    fermer();
  };

  const classeChamp = `champ-choix ${className}`;
  return (
    <>
      <input
        ref={champ}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={ouvert}
        aria-controls={ouvert ? idListe : undefined}
        aria-autocomplete="list"
        aria-activedescendant={ouvert && affiches[actif] ? `${uid}-o${actif}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-choix-recherche={colonne ?? name ?? "choix"}
        data-valeur={valeur}
        placeholder={placeholder ?? vide}
        required={required}
        disabled={disabled}
        value={saisie ?? texte}
        className={classeChamp}
        onChange={(e) => surSaisie(e.target.value)}
        onKeyDown={surClavier}
        onFocus={surFocus}
        onMouseUp={surMouseUp}
        onClick={() => { if (!disabled) setOuvert(true); }}
        onBlur={surBlur}
      />
      {name && <input type="hidden" name={name} value={valeur} disabled={disabled} />}
      {monte && createPortal(
        <span role="status" className="sr-only" data-choix-etat="">
          {ouvert ? (affiches.length === 0 ? "Aucun résultat" : `${total} résultat${total > 1 ? "s" : ""}`) : ""}
        </span>,
        document.body
      )}
      {ouvert && typeof document !== "undefined" && createPortal(
        <>
          <div
            ref={liste}
            id={idListe}
            role="listbox"
            aria-label={ariaLabel}
            style={place ? { position: "fixed", left: place.left, width: place.width, maxHeight: place.maxHeight, top: place.top, bottom: place.bottom } : { position: "fixed", visibility: "hidden" }}
            // Un appui dans la liste ne retire pas le focus du champ (sinon il se ferme avant le clic).
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={() => { appuiDansListe.current = true; }}
            className="z-[70] overflow-y-auto overscroll-contain rounded-md border bg-popover text-sm text-popover-foreground shadow-lg"
          >
            {/* Nombre de résultats, sous la frappe (il y a de quoi choisir, ou pas) */}
            {saisie !== null && saisie.trim() !== "" && affiches.length > 0 && (
              <div role="presentation" className="border-b px-2 py-1 text-xs text-muted-foreground">{total} résultat{total > 1 ? "s" : ""}</div>
            )}
            {blocs.map((b, k) => {
              const options = b.items.map(({ o, i }) => (
                <div
                  key={`${o.id}|${i}`}
                  id={`${uid}-o${i}`}
                  role="option"
                  aria-selected={o.id === valeur}
                  data-choix-id={o.id}
                  data-actif={i === actif ? "" : undefined}
                  onMouseMove={() => { if (i !== actif) setActif(i); }}
                  onClick={(e) => { e.stopPropagation(); choisir(o); }}
                  className={`flex cursor-pointer items-baseline justify-between gap-2 px-2 py-1.5 max-lg:min-h-11 max-lg:items-center max-lg:py-2 ${i === actif ? "bg-accent text-accent-foreground" : ""} ${o.id === valeur ? "font-medium" : ""} ${o.attenue ? "text-muted-foreground" : ""} ${o.id === "" ? "italic text-muted-foreground" : ""}`}
                >
                  <span className="min-w-0 break-words">{o.libelle}</span>
                  {o.detail && <span className="shrink-0 text-xs text-muted-foreground">{o.detail}</span>}
                </div>
              ));
              // Groupe nommé : un vrai groupe, annoncé par son titre. Options sans groupe : un filet les sépare du groupe d'avant.
              return b.groupe ? (
                <div key={`g${k}`} role="group" aria-labelledby={`${uid}-g${k}`}>
                  <div id={`${uid}-g${k}`} className="bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{b.groupe}</div>
                  {options}
                </div>
              ) : (
                <div key={`g${k}`}>
                  {k > 0 && <div role="presentation" className="border-t" />}
                  {options}
                </div>
              );
            })}
            {affiches.length === 0 && (
              <div role="presentation" className="px-2 py-2 text-muted-foreground">Aucun résultat{saisie?.trim() ? ` pour « ${saisie.trim()} »` : ""}.</div>
            )}
            {reste > 0 && (
              <div role="presentation" className="px-2 py-1.5 text-xs text-muted-foreground">… et {reste} autre{reste > 1 ? "s" : ""} : tapez pour préciser.</div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
});
