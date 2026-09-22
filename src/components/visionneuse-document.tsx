"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as PointerEventReact, type RefObject } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DESSINER LE DOCUMENT, PLUTÔT QUE LE CONFIER AU NAVIGATEUR (Sacha, 2026-09-22 :
// « je veux que les aperçus de documents s'ouvrent à la manière de l'application d'aperçu sur
// iPhone »).
//
// LE DÉFAUT RÉEL. PEF affichait ses documents dans une `<iframe>` (bulletin-viewer.tsx,
// contrat-viewer.tsx, bulletins-validation.tsx ×2). Or iOS (WKWebView — donc Safari ET l'app
// installée sur l'écran d'accueil) ne rend AUCUN PDF dans une `<iframe>` : le cadre reste BLANC.
// L'aperçu s'ouvrait bien, en plein écran, et ne montrait rien. Le code l'avouait déjà à demi-mot
// (« sur iOS, l'aperçu PDF en iframe se comporte parfois mal ») en posant un lien « Nouvel onglet »
// comme repli — le symptôme était connu depuis des mois, la cause jamais traitée.
//
// LA PARADE : ne plus demander au NAVIGATEUR d'afficher le document, le DESSINER nous-mêmes.
//   - PDF → chaque page rendue sur un `<canvas>` (pdfjs-dist). C'est le SEUL moyen connu
//     d'afficher un PDF dans une PWA installée sur iOS.
//   - Image → une simple `<img>` : le navigateur sait déjà la décoder.
//   - Tout le reste → AUCUNE PRÉTENTION : un message, et on pointe vers les boutons déjà là.
//     JAMAIS un cadre vide, qui rejouerait le défaut en silence.
//
// CE QUI NE CHANGE PAS. La superposition (portail dans `<body>` pour échapper au
// `overflow-hidden` de la coquille, verrou de défilement, fond sombre, en-tête avec titre et
// actions) reste chez les appelants, telle quelle. Ce composant ne remplace QUE le contenu du
// cadre.
//
// LA RÈGLE QUI NE BOUGE PAS : les boutons de l'en-tête vivent AU-DESSUS de ce composant et NE
// DÉPENDENT JAMAIS de ce qu'il rend. Si le dessin échoue, ce composant le DIT et NOMME les boutons
// RÉELLEMENT présents chez l'appelant (prop `actions`) — il ne propose JAMAIS un nouveau geste, et
// il ne cite jamais un bouton qui n'existe pas à cet endroit-là.
//
// LE TYPE MIME VIENT DE LA ROUTE, JAMAIS DE L'URL. Les routes de PEF (/paie/bulletin/{id},
// /employes/{id}/contrat/{contratId}…) ne portent aucune extension : deviner « .pdf » serait un
// repli en dur qui ferait échouer l'affichage d'une image et ACCUSERAIT un document intact. Le
// composant lit donc le `Content-Type` de la réponse.
//
// UN SEUL ALLER-RETOUR RÉSEAU, ET BORNÉ DANS LE TEMPS. Ces routes GÉNÈRENT le PDF à chaque appel
// (@react-pdf/renderer, aucun en-tête de cache) : une requête pour le type puis une seconde pour
// le contenu le ferait fabriquer DEUX fois. On récupère donc le document une fois, en
// `fetch(…, { credentials: "same-origin" })` — la session voyage avec — puis on donne les OCTETS à
// pdf.js (`getDocument({ data })`). C'est le seul écart assumé au brief de la tâche, qui demandait
// `getDocument({ url, withCredentials: true })` : avec `data`, `withCredentials` est inerte
// (pdf.js ne fait plus la requête), l'ajouter serait du bruit. La garantie demandée — « la session
// accompagne la requête » — est tenue, plus haut, par le `fetch`. Ce `fetch` porte un DÉLAI
// MAXIMAL : sans lui, un réseau qui ne répond pas (Kinshasa) laisserait « Chargement du
// document… » à l'écran indéfiniment, sans jamais dire que ça a échoué.
//
// LE WORKER DE PDFJS EST SERVI PAR L'APPLICATION, JAMAIS UN CDN : `public/pdf.worker.min.mjs`,
// copié depuis `node_modules` par `scripts/copier-worker-pdfjs.mjs` (`postinstall` indulgent, pour
// ne pas casser une installation ; `prebuild` intransigeant, parce que c'est là qu'échouer est
// utile). Et il est EXCLU du motif de `src/proxy.ts` — sans quoi le garde d'authentification
// répondrait 307 vers /login sur un fichier que le navigateur va chercher tout seul (piège déjà
// refermé trois fois dans cette famille de dépôts ; vérifié par src/lib/chemins-publics.test.ts).
//
// pdfjs-dist EN IMPORT PARESSEUX (`await import`), et SEULEMENT pour un PDF : ni son code
// (plusieurs centaines de kilo-octets) ni son worker ne doivent peser sur un écran qui n'affiche
// aucun document. pdfjs 5.x se sert de `Promise.withResolvers` (31 fois) et Next ne transpile pas
// `node_modules` : sous iOS 17.4, TOUT échouerait. Un polyfill de quelques lignes est posé juste
// avant l'import — l'équipe n'a pas que des téléphones récents.
// ─────────────────────────────────────────────────────────────────────────────

export type ModeAffichageDocument = "pdf" | "image" | "aucun";

/**
 * Choix PUR du mode d'affichage, à partir du seul type MIME réel du document (`Content-Type` de sa
 * route). Fonction séparée du composant pour rester testable SANS DOM — ce dépôt tourne en
 * `environment: "node"` (vitest.config.ts) et ne dispose que de `renderToStaticMarkup`.
 *
 * Le paramètre du `Content-Type` est écarté (« application/pdf; charset=binary ») : un
 * `Content-Type` réel en porte souvent, et comparer la chaîne entière ferait retomber un PDF
 * parfaitement valide dans « aucun » — c'est-à-dire refuser d'afficher un document intact.
 */
export function modeAffichageDocument(mime: string | null | undefined): ModeAffichageDocument {
  const valeur = (mime ?? "").toLowerCase().split(";")[0].trim();
  if (valeur === "application/pdf") return "pdf";
  if (valeur.startsWith("image/")) return "image";
  return "aucun";
}

// ── Gestes façon « Aperçu » d'iPhone : toutes les décisions en fonctions PURES ────────────────

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** Le palier d'un double-tap : assez pour lire une ligne de bulletin au doigt, sans tout perdre. */
export const ZOOM_DOUBLE_TAP = 2.5;
/** Un doigt qui glisse de plus de ça vers le bas referme (ou une détente franche, voir ci-dessous). */
export const SEUIL_FERMETURE_PX = 110;
/** …ou un geste vif : px par milliseconde. */
export const SEUIL_VITESSE_FERMETURE = 0.45;
export const DELAI_DOUBLE_TAP_MS = 320;
export const TOLERANCE_TAP_PX = 30;
export const DUREE_TAP_MAX_MS = 350;
/** Au-delà de ce délai, on DIT que le chargement a échoué au lieu de faire tourner indéfiniment. */
export const DELAI_RECUPERATION_MS = 30_000;

/**
 * Côté maximal, en pixels PHYSIQUES, d'un `<canvas>` : iOS refuse de dessiner au-delà d'une
 * certaine dimension et rend alors un canvas VIDE (blanc) — exactement le symptôme que cette
 * visionneuse existe pour supprimer.
 */
export const COTE_PIXELS_MAX = 4096;

/**
 * Budget de pixels pour l'ENSEMBLE des pages d'un document, pas pour une page.
 *
 * ⚠️ LE DÉFAUT QUE CE BUDGET CORRIGE (relecture, 2026-09-22). Toutes les pages sont dessinées ET
 * CONSERVÉES simultanément (c'est voulu : on ne veut pas perdre la position de lecture à chaque
 * pincement). Un plafond qui ne protège qu'UNE page laissait donc passer leur SOMME : un contrat
 * de 4 pages double-tapé atteignait ≈ 45 millions de pixels, soit ≈ 180 Mo (4 octets par pixel en
 * RGBA). iOS purge alors les surfaces et les rend BLANCHES — le symptôme même qu'on supprime.
 *
 * 12 millions de pixels ≈ 48 Mo, quel que soit le nombre de pages : le budget est DIVISÉ par le
 * nombre de pages (`budgetSurfaceParPage`). Un document long est donc dessiné un peu moins fin —
 * moins net vaut mieux que blanc.
 */
export const BUDGET_PIXELS_TOTAL = 12_000_000;

/**
 * Les trois façons dont un pointeur peut finir. `lostpointercapture` n'est PAS décoratif : sans
 * lui, un `pointerup` tactile égaré (capture reprise par le système, geste interrompu…) laisse une
 * entrée FANTÔME dans la table des pointeurs — et tout toucher ultérieur est alors compté comme
 * deux doigts : le zoom saute, et « glisser pour refermer » ne s'arme plus jamais. Le composant
 * boucle sur CETTE liste pour brancher ses écouteurs : en retirer un ici le débranche réellement.
 */
export const EVENEMENTS_FIN_POINTEUR = ["pointerup", "pointercancel", "lostpointercapture"] as const;

export function bornerZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Double-tap : on repart de 1 dès qu'on est zoomé, sinon on monte au palier. */
export function zoomApresDoubleTap(zoomActuel: number): number {
  return zoomActuel > ZOOM_MIN + 0.01 ? ZOOM_MIN : ZOOM_DOUBLE_TAP;
}

/** Pincement : le zoom suit le RAPPORT des distances entre les deux doigts, borné. */
export function zoomPince(zoomDepart: number, distanceDepart: number, distanceCourante: number): number {
  if (!(distanceDepart > 0) || !(distanceCourante > 0)) return bornerZoom(zoomDepart);
  return bornerZoom(zoomDepart * (distanceCourante / distanceDepart));
}

export function distanceEntrePointeurs(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Le panneau suit le doigt, mais amorti : un glissement de 100 px ne le descend que de 60. */
export function glissementAmorti(dy: number): number {
  return dy > 0 ? dy * 0.6 : 0;
}

/**
 * Échelle appliquée au conteneur PENDANT un pincement — le retour visuel immédiat.
 *
 * ⚠️ LE DÉFAUT CORRIGÉ (relecture, 2026-09-22) : la page ne bougeait pas de tout le geste, puis
 * sautait 90 ms après le relâchement. En mode image le zoom était direct : l'incohérence se voyait.
 * Sacha a demandé « à la manière de l'application d'aperçu sur iPhone » — un pincement qui ne suit
 * pas les doigts ne tient pas cette promesse, ce n'est donc pas un raffinement optionnel. Un
 * `transform: scale()` suit les doigts image par image ; on ne redessine à la bonne définition
 * qu'AU RELÂCHEMENT.
 */
export function echelleProvisoire(zoomCible: number, zoomDepart: number): number {
  if (!(zoomDepart > 0) || !Number.isFinite(zoomCible)) return 1;
  return zoomCible / zoomDepart;
}

/**
 * Position de défilement qui garde un point ANCRÉ sous les doigts après un zoom, sur un axe.
 *
 * `scrollDepart + ancreDepart` = coordonnée du point dans le CONTENU au début du geste ; après un
 * agrandissement de `rapport`, ce point est à `rapport ×` cette coordonnée, et on veut le
 * retrouver sous `ancreCourante` (le milieu des doigts, qui a pu se déplacer). Sans ce recalage,
 * zoomer fait perdre la ligne qu'on était en train de lire.
 */
export function positionAncree(rapport: number, scrollDepart: number, ancreDepart: number, ancreCourante: number): number {
  return Math.max(0, rapport * (scrollDepart + ancreDepart) - ancreCourante);
}

/** La translation à appliquer AVEC l'échelle provisoire, pour ancrer sans toucher au défilement
 *  (y toucher pendant le geste le ferait borner par la taille NON transformée du contenu). */
export function translationPince(rapport: number, scrollDepart: number, ancreDepart: number, ancreCourante: number): number {
  return scrollDepart - (rapport * (scrollDepart + ancreDepart) - ancreCourante);
}

export type GesteVertical = {
  /** Déplacement vertical depuis le point de contact (positif = vers le bas). */
  dy: number;
  dx: number;
  dureeMs: number;
  zoom: number;
  /** Position de défilement AU MOMENT DU CONTACT : on ne referme qu'en haut du document. */
  scrollTopDepart: number;
  nombrePointeurs: number;
};

/**
 * Faut-il refermer ? Décision PURE, testée — c'est elle qui empêche le zoom de piéger le doigt.
 *
 * Quatre conditions, toutes nécessaires :
 *   • UN seul doigt (un pincement n'est jamais une fermeture) ;
 *   • pas de zoom en cours (zoomé, le glissement sert à se déplacer DANS la page) ;
 *   • on était déjà en haut du document (sinon le glissement est un défilement) ;
 *   • l'intention est verticale et vers le bas (`dy > |dx|`).
 * Alors seulement : une distance franche, OU un geste vif.
 */
export function decisionFermetureGeste(geste: GesteVertical): boolean {
  const { dy, dx, dureeMs, zoom, scrollTopDepart, nombrePointeurs } = geste;
  if (nombrePointeurs !== 1) return false;
  if (zoom > ZOOM_MIN + 0.01) return false;
  if (scrollTopDepart > 0) return false;
  if (dy <= 0 || dy <= Math.abs(dx)) return false;
  if (dy >= SEUIL_FERMETURE_PX) return true;
  return dureeMs > 0 && dy / dureeMs >= SEUIL_VITESSE_FERMETURE;
}

export type Tap = { x: number; y: number; t: number };

export function estTap(dx: number, dy: number, dureeMs: number): boolean {
  return Math.hypot(dx, dy) <= TOLERANCE_TAP_PX && dureeMs <= DUREE_TAP_MAX_MS;
}

export function estDoubleTap(precedent: Tap | null, courant: Tap): boolean {
  if (!precedent) return false;
  return (
    courant.t - precedent.t <= DELAI_DOUBLE_TAP_MS &&
    Math.hypot(courant.x - precedent.x, courant.y - precedent.y) <= TOLERANCE_TAP_PX
  );
}

/** Qui tient le doigt pendant CE geste : nous, ou le navigateur et son défilement natif. */
export type ModeGeste = "nous" | "navigateur";

/** Décidé UNE FOIS, au contact, à partir du zoom et du `scrollTop` RÉELS de ce moment-là. */
export function modeGesteAuContact(zoom: number, scrollTopAuContact: number): ModeGeste {
  return zoom <= ZOOM_MIN + 0.01 && scrollTopAuContact <= 0 ? "nous" : "navigateur";
}

export type Geste = {
  x: number;
  y: number;
  t: number;
  zoomDepart: number;
  scrollTopDepart: number;
  mode: ModeGeste;
  /** Le plus grand nombre de doigts vus pendant ce geste (un pincement ne referme jamais). */
  nombreMax: number;
};

export function commencerGeste(params: { x: number; y: number; t: number; zoom: number; scrollTop: number }): Geste {
  return {
    x: params.x,
    y: params.y,
    t: params.t,
    zoomDepart: params.zoom,
    scrollTopDepart: params.scrollTop,
    mode: modeGesteAuContact(params.zoom, params.scrollTop),
    nombreMax: 1,
  };
}

export type ActionGeste =
  | { type: "rien" }
  | { type: "defiler"; scrollTop: number }
  | { type: "suivreLeDoigt"; translation: number };

/**
 * Ce qu'il faut faire à chaque mouvement — fonction PURE du geste FIGÉ et du déplacement.
 *
 * ⚠️ LE DÉFAUT CORRIGÉ (relecture, 2026-09-22), BLOQUANT. La décision était reprise à CHAQUE
 * mouvement, à partir de l'état React « en haut ». Or, en haut et non zoomé, `touch-action` vaut
 * `none` : c'est NOUS qui défilons, à la main — ce qui fait aussitôt passer « en haut » à faux, et
 * le mouvement suivant ne faisait plus rien. Le doigt avançait d'environ 8 px puis SE BLOQUAIT
 * jusqu'à ce qu'on le lève. C'était le tout premier geste de chaque consultation, en haut de
 * chaque document, sur l'appareil pour lequel ce lot existe.
 *
 * La règle qui en sort : le mode est FIGÉ au contact (`commencerGeste`) et rien de vivant n'est
 * relu avant le relâchement. C'est pour cela que cette fonction ne reçoit QUE le geste figé.
 */
export function avancerGeste(geste: Geste, dy: number, nombrePointeurs: number): ActionGeste {
  if (nombrePointeurs !== 1) return { type: "rien" };
  if (geste.mode !== "nous") return { type: "rien" };
  // Doigt vers le haut = on descend dans le document : défilement repris à la main.
  if (dy < 0) return { type: "defiler", scrollTop: Math.max(0, geste.scrollTopDepart - dy) };
  return { type: "suivreLeDoigt", translation: glissementAmorti(dy) };
}

/**
 * `touch-action` de la zone de lecture, posé ENTRE les gestes (jamais relu PENDANT).
 *
 *  • « pan-x pan-y » : le navigateur garde le défilement NATIF (et son inertie, qu'on ne saurait
 *    pas imiter), mais PERD le pincement — le jeton `pinch-zoom` est absent, donc notre propre
 *    gestion du pincement est la seule à s'exécuter, sans lutter contre le zoom de page d'iOS.
 *  • « none » quand on est EN HAUT et non zoomé, c'est-à-dire exactement quand le prochain
 *    glissement vers le bas doit refermer : sinon iOS s'empare du geste (rebond d'« overscroll »)
 *    et envoie un `pointercancel` — la fermeture ne partirait jamais.
 */
export function toucheActionZone(zoom: number, enHaut: boolean): "none" | "pan-x pan-y" {
  return zoom <= ZOOM_MIN + 0.01 && enHaut ? "none" : "pan-x pan-y";
}

export type DimensionsCanvasPdf = {
  /** Échelle à donner à `page.getViewport` — INCLUT le `devicePixelRatio`. */
  echelle: number;
  /** `canvas.width`/`canvas.height` — pixels PHYSIQUES de la surface de dessin. */
  largeurPixels: number;
  hauteurPixels: number;
  /** `canvas.style.width`/`canvas.style.height` — pixels CSS, l'espace réellement occupé. */
  largeurCss: number;
  hauteurCss: number;
};

/** Le budget de pixels d'UNE page : le budget total divisé par le nombre de pages conservées. */
export function budgetSurfaceParPage(nombrePages: number, budgetTotal: number = BUDGET_PIXELS_TOTAL): number {
  return budgetTotal / Math.max(1, nombrePages);
}

/**
 * Dimensions d'un `<canvas>` qui dessine une page PDF NETTE sur un écran à haute densité —
 * fonction PURE (ce dépôt n'a pas de DOM en test).
 *
 * ⚠️ SANS `devicePixelRatio`, UN PDF EST FLOU SUR TÉLÉPHONE. Poser `canvas.width = viewport.width`
 * dessine à l'échelle CSS seule : un pixel de canvas pour un pixel CSS. Sur un DPR 2 ou 3 (tous
 * les iPhone, l'appareil pour lequel cette visionneuse existe) le navigateur ÉTIRE ensuite cette
 * surface, et un bulletin redevient illisible. Montrer le document sans le rendre lisible, c'est
 * rater la demande.
 *
 * LE PATRON (celui que recommande pdf.js) : dessiner à `échelle CSS × DPR` pixels PHYSIQUES, puis
 * poser `canvas.style.width/height` en pixels CSS pour que l'écran occupe le MÊME espace — seule
 * la définition change, pas la taille affichée.
 *
 * DEUX PLAFONDS, qui ne protègent pas de la même chose :
 *  • `cotePixelsMax` : une DIMENSION qu'iOS refuse de dessiner ;
 *  • `surfacePixelsMax` : la MÉMOIRE, qui se compte sur toutes les pages conservées à la fois
 *    (cf. `BUDGET_PIXELS_TOTAL`) — un plafond par page seul laissait passer leur somme.
 * Les deux réduisent l'échelle de DESSIN sans toucher à la taille CSS : moins net vaut mieux
 * qu'une page blanche.
 */
export function dimensionsCanvasPdf(
  largeurDisponible: number,
  largeurBase: number,
  hauteurBase: number,
  dpr: number,
  cotePixelsMax: number = COTE_PIXELS_MAX,
  surfacePixelsMax: number = BUDGET_PIXELS_TOTAL,
): DimensionsCanvasPdf {
  const largeur = Math.max(1, largeurDisponible);
  const base = Math.max(1, largeurBase);
  const hauteur = Math.max(1, hauteurBase);
  const echelleCss = largeur / base;
  const densite = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

  let echelle = echelleCss * densite;

  const cotePhysiqueMax = Math.max(base, hauteur) * echelle;
  if (cotePixelsMax > 0 && cotePhysiqueMax > cotePixelsMax) {
    echelle = echelle * (cotePixelsMax / cotePhysiqueMax);
  }

  const surface = base * echelle * hauteur * echelle;
  if (surfacePixelsMax > 0 && Number.isFinite(surfacePixelsMax) && surface > surfacePixelsMax) {
    echelle = echelle * Math.sqrt(surfacePixelsMax / surface);
  }

  return {
    echelle,
    largeurCss: Math.round(base * echelleCss),
    hauteurCss: Math.round(hauteur * echelleCss),
    largeurPixels: Math.round(base * echelle),
    hauteurPixels: Math.round(hauteur * echelle),
  };
}

/**
 * Nomme les boutons RÉELLEMENT présents dans l'en-tête de l'appelant.
 *
 * ⚠️ LE DÉFAUT CORRIGÉ (relecture, 2026-09-22) : le message d'échec citait « Nouvel onglet », qui
 * n'existe pas dans la barre de l'aperçu inline d'ordinateur. Envoyer quelqu'un vers un bouton
 * absent, c'est une deuxième impasse posée au moment où la première vient de se refermer.
 */
export function phraseActions(actions: readonly string[]): string {
  const nettes = actions
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => `« ${a} »`);
  if (nettes.length === 0) return "les boutons ci-dessus";
  if (nettes.length === 1) return nettes[0];
  return `${nettes.slice(0, -1).join(", ")} ou ${nettes[nettes.length - 1]}`;
}

type AvecWithResolvers = { withResolvers?: unknown };

/**
 * Pose `Promise.withResolvers` s'il manque. Renvoie `true` s'il a fallu le poser.
 *
 * pdfjs 5.x s'en sert 31 fois, et Next ne transpile pas `node_modules` : sur un iOS antérieur à
 * 17.4 (mars 2024), l'import du module échoue en entier et AUCUN document ne s'affiche. L'équipe
 * n'a pas que des téléphones récents ; quelques lignes valent mieux qu'un écran d'échec.
 */
export function poserPolyfillWithResolvers(cible: AvecWithResolvers): boolean {
  if (typeof cible.withResolvers === "function") return false;
  cible.withResolvers = function <T>() {
    let resolve!: (valeur: T | PromiseLike<T>) => void;
    let reject!: (raison?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  return true;
}

/**
 * Récupère le document en UNE requête, BORNÉE DANS LE TEMPS, et rend son type réel avec ses
 * octets. Sans ce délai maximal, un réseau qui ne répond jamais laisse « Chargement du document… »
 * à l'écran pour toujours : l'écran ne montre rien ET ne dit pas qu'il a échoué.
 */
export async function recupererDocument(
  src: string,
  delaiMs: number = DELAI_RECUPERATION_MS,
): Promise<{ mime: string | null; blob: Blob }> {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);
  try {
    const reponse = await fetch(src, { credentials: "same-origin", signal: controleur.signal });
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
    const mime = reponse.headers.get("Content-Type");
    // Le délai couvre AUSSI la lecture du corps : un flux qui s'arrête au milieu n'y échappe pas.
    const blob = await reponse.blob();
    return { mime, blob };
  } finally {
    clearTimeout(minuteur);
  }
}

type Phase = "chargement" | "pdf" | "image" | "aucun" | "echec";

/**
 * Le message d'état, séparé du composant piloté par les effets — testable en lui donnant
 * directement la phase voulue, puisque les `useEffect` ne s'exécutent jamais sous
 * `renderToStaticMarkup`.
 *
 * AUCUN LIEN, AUCUN BOUTON ICI. Les actions vivent déjà dans l'en-tête de l'appelant, au-dessus,
 * et fonctionnent que ce dessin réussisse ou non. Un message d'échec qui proposerait ICI un
 * nouveau geste referait le pari perdant d'une sortie de secours posée SOUS le cadre qu'elle était
 * censée secourir.
 */
export function MessageEtatDocument({
  phase,
  actions = ["Télécharger"],
}: {
  phase: Phase;
  actions?: readonly string[];
}) {
  if (phase === "chargement") {
    return (
      <p role="status" className="px-3 py-2 text-center text-xs text-white/80">
        Chargement du document…
      </p>
    );
  }
  if (phase === "echec") {
    return (
      <p role="alert" className="px-3 py-2 text-center text-xs text-white">
        L&apos;affichage a échoué. Utilisez {phraseActions(actions)} ci-dessus pour consulter le
        document.
      </p>
    );
  }
  if (phase === "aucun") {
    return (
      <p role="status" className="px-3 py-2 text-center text-xs text-white">
        Ce type de document ne s&apos;affiche pas ici. Utilisez {phraseActions(actions)} ci-dessus
        pour le consulter.
      </p>
    );
  }
  return null;
}

export function VisionneuseDocument({
  src,
  titre,
  onFermer,
  panneauRef,
  actions = ["Télécharger"],
  className = "",
}: {
  /** Adresse de la route qui sert le document, en `inline` (sans `dl=1`). */
  src: string;
  /** Titre lisible, utilisé comme texte alternatif (image) et comme étiquette de chaque page. */
  titre: string;
  /** Fermeture de la superposition — appelée par le geste « glisser vers le bas ». Absente pour
   *  l'aperçu inline d'ordinateur, qui n'est dans aucune superposition. */
  onFermer?: () => void;
  /** Le panneau de la superposition, qui suit le doigt pendant le glissement de fermeture. */
  panneauRef?: RefObject<HTMLElement | null>;
  /** Les boutons RÉELLEMENT présents dans l'en-tête de cet appelant-là : le message d'échec ne
   *  cite jamais un bouton qui n'existe pas à cet endroit. */
  actions?: readonly string[];
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("chargement");
  const [urlImage, setUrlImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [enHaut, setEnHaut] = useState(true);

  const zoneRef = useRef<HTMLDivElement>(null);
  const contenuRef = useRef<HTMLDivElement>(null);
  // `any` assumé : typer pdfjs-dist statiquement tirerait le module dans le bundle de tous les
  // écrans — ce que l'import paresseux existe précisément pour éviter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const documentRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tachesRef = useRef<any[]>([]);
  const generationRef = useRef(0);
  /** Défilement à restaurer après le redessin, pour garder la ligne lue sous les doigts. */
  const scrollCibleRef = useRef<{ left: number; top: number } | null>(null);

  const pointeursRef = useRef(new Map<number, { x: number; y: number }>());
  const pinceRef = useRef<{
    distanceDepart: number;
    zoomDepart: number;
    zoomCible: number;
    scrollDepart: { left: number; top: number };
    ancreDepart: { x: number; y: number };
  } | null>(null);
  const glissRef = useRef<Geste | null>(null);
  const dernierTapRef = useRef<Tap | null>(null);

  // ── Récupération du document : UNE requête bornée, qui donne le type réel ET les octets ──
  useEffect(() => {
    let annule = false;
    let urlObjet: string | null = null;

    // Aucune remise à zéro synchrone ici : les appelants posent un `key` construit sur `src`, donc
    // un document différent REMONTE le composant, qui repart de son état initial.
    (async () => {
      try {
        const { mime, blob } = await recupererDocument(src);
        if (annule) return;

        // Le type RÉEL, tel que la route l'annonce — jamais déduit de l'adresse.
        const mode = modeAffichageDocument(mime);
        if (mode === "aucun") {
          setPhase("aucun");
          return;
        }

        if (mode === "image") {
          urlObjet = URL.createObjectURL(blob);
          setUrlImage(urlObjet);
          setPhase("image");
          return;
        }

        const octets = new Uint8Array(await blob.arrayBuffer());
        if (annule) return;

        // AVANT l'import : pdfjs 5.x se sert de `Promise.withResolvers` dès son évaluation, et
        // Next ne transpile pas `node_modules`.
        poserPolyfillWithResolvers(Promise as unknown as AvecWithResolvers);

        // Import paresseux : pdfjs-dist ne charge JAMAIS pour une image, un type inconnu, ou
        // n'importe quel autre écran de l'application.
        const pdfjs = await import("pdfjs-dist");
        if (annule) return;
        // JAMAIS un CDN : notre propre fichier statique, copié à l'installation.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjs.getDocument({ data: octets }).promise;
        if (annule) {
          doc.destroy();
          return;
        }
        documentRef.current = doc;
        setPhase("pdf");
      } catch {
        // Corrompu, mémoire, worker inatteignable, délai dépassé, session expirée… peu importe la
        // cause : on le DIT, et les boutons de l'en-tête restent utilisables au-dessus.
        if (!annule) setPhase("echec");
      }
    })();

    return () => {
      annule = true;
      if (urlObjet) URL.revokeObjectURL(urlObjet);
      for (const tache of tachesRef.current) {
        try {
          tache.cancel();
        } catch {
          /* déjà terminée */
        }
      }
      tachesRef.current = [];
      const doc = documentRef.current;
      documentRef.current = null;
      if (doc) doc.destroy();
    };
  }, [src]);

  // ── Dessin (et redessin) des pages ────────────────────────────────────────────────────────
  const dessiner = useCallback(async () => {
    const doc = documentRef.current;
    const zone = zoneRef.current;
    const contenu = contenuRef.current;
    if (!doc || !zone || !contenu) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    for (const tache of tachesRef.current) {
      try {
        tache.cancel();
      } catch {
        /* déjà terminée */
      }
    }
    tachesRef.current = [];

    // Largeur du CONTENEUR, pas de la fenêtre (l'aperçu d'ordinateur vit dans une colonne), moins
    // le liseré de 8 px de chaque côté ; multipliée par le zoom courant, ce qui fait déborder la
    // zone et rend le défilement à deux axes — exactement le comportement d'Aperçu.
    const largeurCible = Math.max(1, zone.clientWidth - 16) * zoom;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    // Le budget de MÉMOIRE se partage entre toutes les pages, qui restent toutes dessinées.
    const surfaceParPage = budgetSurfaceParPage(doc.numPages);

    try {
      for (let numero = 1; numero <= doc.numPages; numero += 1) {
        if (generation !== generationRef.current) return;
        const page = await doc.getPage(numero);
        if (generation !== generationRef.current) return;

        const base = page.getViewport({ scale: 1 });
        const dims = dimensionsCanvasPdf(largeurCible, base.width, base.height, dpr, COTE_PIXELS_MAX, surfaceParPage);

        let canvas = canvasRef.current[numero - 1];
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvas.className = "block rounded bg-white shadow-sm";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${titre} — page ${numero} sur ${doc.numPages}`);
          canvasRef.current[numero - 1] = canvas;
          contenu.appendChild(canvas);
        }
        // On redéfinit la surface d'un `<canvas>` GARDÉ d'un zoom à l'autre, précisément pour ne
        // pas perdre la position de lecture à chaque pincement.
        canvas.width = dims.largeurPixels;
        canvas.height = dims.hauteurPixels;
        canvas.style.width = `${dims.largeurCss}px`;
        canvas.style.height = `${dims.hauteurCss}px`;

        const tache = page.render({ canvas, viewport: page.getViewport({ scale: dims.echelle }) });
        tachesRef.current.push(tache);
        try {
          await tache.promise;
        } catch {
          // Rendu annulé par un nouveau zoom / une rotation : ce n'est pas un échec.
          return;
        }
      }

      // Le dessin est à la bonne définition : on retire seulement MAINTENANT l'agrandissement
      // provisoire du pincement (l'enlever plus tôt ferait revenir la page à sa taille d'avant le
      // temps du redessin), puis on pose le défilement qui garde la ligne lue sous les doigts.
      if (contenu.style.transform) contenu.style.transform = "";
      const cible = scrollCibleRef.current;
      if (cible) {
        scrollCibleRef.current = null;
        zone.scrollLeft = cible.left;
        zone.scrollTop = cible.top;
      }
    } catch {
      setPhase("echec");
    }
  }, [titre, zoom]);

  // Premier dessin, puis redessin à chaque changement de zoom (le canvas est redessiné à la
  // définition du nouveau zoom, sinon un PDF zoomé ×3 serait une image agrandie, donc floue).
  useEffect(() => {
    if (phase !== "pdf") return;
    const minuteur = window.setTimeout(() => void dessiner(), 90);
    return () => window.clearTimeout(minuteur);
  }, [phase, zoom, dessiner]);

  // Rotation de l'écran / redimensionnement : la largeur disponible change, il faut redessiner.
  useEffect(() => {
    if (phase !== "pdf") return;
    const zone = zoneRef.current;
    if (!zone || typeof ResizeObserver === "undefined") return;
    let largeurConnue = zone.clientWidth;
    let minuteur = 0;
    const observateur = new ResizeObserver(() => {
      const largeur = zone.clientWidth;
      if (Math.abs(largeur - largeurConnue) < 8) return;
      largeurConnue = largeur;
      window.clearTimeout(minuteur);
      minuteur = window.setTimeout(() => void dessiner(), 150);
    });
    observateur.observe(zone);
    return () => {
      window.clearTimeout(minuteur);
      observateur.disconnect();
    };
  }, [phase, dessiner]);

  // ── Gestes ────────────────────────────────────────────────────────────────────────────────
  const reposerPanneau = useCallback(
    (anime: boolean) => {
      const panneau = panneauRef?.current;
      if (!panneau) return;
      // Le panneau de la superposition suit le doigt : une animation de geste se joue sur le DOM,
      // image par image, jamais par un rendu React (qui rendrait le glissement saccadé).
      // eslint-disable-next-line react-hooks/immutability -- mutation d'un élément DOM, pas d'une prop
      panneau.style.transition = anime ? "transform 180ms ease-out" : "";
      panneau.style.transform = "";
      if (anime) window.setTimeout(() => panneau && (panneau.style.transition = ""), 200);
    },
    [panneauRef],
  );

  /** Milieu des deux doigts, en coordonnées de la ZONE (0,0 = son coin haut-gauche visible). */
  function milieuDansLaZone(a: { x: number; y: number }, b: { x: number; y: number }) {
    const rect = zoneRef.current?.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - (rect?.left ?? 0), y: (a.y + b.y) / 2 - (rect?.top ?? 0) };
  }

  function onPointerDown(e: PointerEventReact<HTMLDivElement>) {
    // Capture explicite : sans elle, un `pointerup` tactile égaré laisse une entrée fantôme dans
    // la table, et tout toucher ultérieur est compté comme deux doigts (cf.
    // EVENEMENTS_FIN_POINTEUR). La capture garantit qu'on reçoit toujours une fin de pointeur.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* refusé par le navigateur : la capture implicite tactile fera l'affaire */
    }

    const pointeurs = pointeursRef.current;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const zone = zoneRef.current;

    if (pointeurs.size === 2 && zone) {
      const [a, b] = [...pointeurs.values()];
      pinceRef.current = {
        distanceDepart: distanceEntrePointeurs(a, b),
        zoomDepart: zoom,
        zoomCible: zoom,
        scrollDepart: { left: zone.scrollLeft, top: zone.scrollTop },
        ancreDepart: milieuDansLaZone(a, b),
      };
      // Un pincement n'est jamais une fermeture ni un tap.
      glissRef.current = null;
      dernierTapRef.current = null;
      reposerPanneau(false);
      return;
    }

    if (pointeurs.size === 1) {
      glissRef.current = commencerGeste({
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        zoom,
        scrollTop: zone?.scrollTop ?? 0,
      });
    }
  }

  function onPointerMove(e: PointerEventReact<HTMLDivElement>) {
    const pointeurs = pointeursRef.current;
    if (!pointeurs.has(e.pointerId)) return;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const gliss = glissRef.current;
    if (gliss) gliss.nombreMax = Math.max(gliss.nombreMax, pointeurs.size);

    const zone = zoneRef.current;
    const contenu = contenuRef.current;

    // ── Pincer pour zoomer : retour visuel IMMÉDIAT, redessin seulement au relâchement ──
    const pince = pinceRef.current;
    if (pointeurs.size >= 2 && pince && zone && contenu) {
      const [a, b] = [...pointeurs.values()];
      pince.zoomCible = zoomPince(pince.zoomDepart, pince.distanceDepart, distanceEntrePointeurs(a, b));
      const rapport = echelleProvisoire(pince.zoomCible, pince.zoomDepart);
      const ancre = milieuDansLaZone(a, b);
      const tx = translationPince(rapport, pince.scrollDepart.left, pince.ancreDepart.x, ancre.x);
      const ty = translationPince(rapport, pince.scrollDepart.top, pince.ancreDepart.y, ancre.y);
      // On ne touche PAS au défilement pendant le geste : il serait borné par la taille NON
      // transformée du contenu. La translation fait tout le travail, et ancre le milieu des doigts.
      contenu.style.transformOrigin = "0 0";
      contenu.style.transform = `translate(${tx}px, ${ty}px) scale(${rapport})`;
      return;
    }

    if (!gliss || pointeurs.size !== 1 || !zone) return;

    // Le mode a été FIGÉ au contact : plus rien de vivant n'est relu ici (sinon le défilement à la
    // main se bloquerait dès le premier mouvement — cf. `avancerGeste`).
    const action = avancerGeste(gliss, e.clientY - gliss.y, pointeurs.size);
    if (action.type === "defiler") {
      zone.scrollTop = action.scrollTop;
      reposerPanneau(false);
      return;
    }
    if (action.type === "suivreLeDoigt") {
      const panneau = panneauRef?.current;
      if (panneau) {
        // Idem : le suivi du doigt se joue sur le DOM, pas par un rendu React.
        // eslint-disable-next-line react-hooks/immutability -- mutation d'un élément DOM, pas d'une prop
        panneau.style.transition = "";
        panneau.style.transform = `translateY(${action.translation}px)`;
      }
    }
  }

  /** Valide le zoom atteint au pincement : on redessine à la bonne définition, en gardant la
   *  ligne lue là où elle était. */
  function terminerPince() {
    const pince = pinceRef.current;
    pinceRef.current = null;
    if (!pince) return;
    const rapport = echelleProvisoire(pince.zoomCible, pince.zoomDepart);
    if (Math.abs(rapport - 1) < 0.01) return;
    scrollCibleRef.current = {
      left: positionAncree(rapport, pince.scrollDepart.left, pince.ancreDepart.x, pince.ancreDepart.x),
      top: positionAncree(rapport, pince.scrollDepart.top, pince.ancreDepart.y, pince.ancreDepart.y),
    };
    setZoom(pince.zoomCible);
  }

  function finDePointeur(e: PointerEvent) {
    const pointeurs = pointeursRef.current;
    const gliss = glissRef.current;
    const nombreAvant = pointeurs.size;
    pointeurs.delete(e.pointerId);

    if (pointeurs.size < 2 && pinceRef.current) {
      // Un doigt s'est levé : on fige le zoom atteint — sauf si le geste a été ANNULÉ (capture
      // perdue, interruption système), auquel cas on abandonne le pincement sans rien valider.
      if (e.type === "pointerup") terminerPince();
      else pinceRef.current = null;
    }

    if (e.type !== "pointerup" || nombreAvant >= 2 || !gliss) {
      if (pointeurs.size === 0) {
        glissRef.current = null;
        if (e.type !== "pointerup") dernierTapRef.current = null;
        reposerPanneau(true);
      }
      return;
    }

    glissRef.current = null;
    const dx = e.clientX - gliss.x;
    const dy = e.clientY - gliss.y;
    const dureeMs = e.timeStamp - gliss.t;

    const fermer = decisionFermetureGeste({
      dy,
      dx,
      dureeMs,
      zoom: gliss.zoomDepart,
      scrollTopDepart: gliss.scrollTopDepart,
      nombrePointeurs: gliss.nombreMax,
    });
    if (fermer && onFermer) {
      reposerPanneau(false);
      onFermer();
      return;
    }
    reposerPanneau(true);

    // Double-tap pour zoomer / dézoomer d'un coup, ANCRÉ sur le point tapé.
    if (gliss.nombreMax === 1 && estTap(dx, dy, dureeMs)) {
      const tap: Tap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (estDoubleTap(dernierTapRef.current, tap)) {
        dernierTapRef.current = null;
        const nouveau = zoomApresDoubleTap(gliss.zoomDepart);
        const zone = zoneRef.current;
        if (zone) {
          const rect = zone.getBoundingClientRect();
          const ancreX = e.clientX - rect.left;
          const ancreY = e.clientY - rect.top;
          const rapport = nouveau / gliss.zoomDepart;
          scrollCibleRef.current = {
            left: positionAncree(rapport, zone.scrollLeft, ancreX, ancreX),
            top: positionAncree(rapport, zone.scrollTop, ancreY, ancreY),
          };
        }
        setZoom(nouveau);
      } else {
        dernierTapRef.current = tap;
      }
    }
  }

  // Les trois fins de pointeur sont branchées depuis LA liste `EVENEMENTS_FIN_POINTEUR` : en
  // retirer une là-haut la débranche réellement ici. Sans tableau de dépendances : trois écouteurs
  // par rendu coûtent moins qu'une closure périmée sur `zoom` ou `onFermer`.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const gestionnaire = (evenement: Event) => finDePointeur(evenement as PointerEvent);
    for (const nom of EVENEMENTS_FIN_POINTEUR) zone.addEventListener(nom, gestionnaire);
    return () => {
      for (const nom of EVENEMENTS_FIN_POINTEUR) zone.removeEventListener(nom, gestionnaire);
    };
  });

  function onScroll() {
    const zone = zoneRef.current;
    if (!zone) return;
    const haut = zone.scrollTop <= 0;
    setEnHaut((precedent) => (precedent === haut ? precedent : haut));
  }

  const styleZone = { touchAction: toucheActionZone(zoom, enHaut) } as const;

  return (
    <div className={`flex min-h-0 flex-1 flex-col bg-neutral-800 ${className}`}>
      <div
        ref={zoneRef}
        style={styleZone}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onScroll={onScroll}
        className="min-h-0 flex-1 select-none overflow-auto overscroll-contain"
      >
        {phase === "pdf" ? (
          // Les `<canvas>` sont posés ICI par l'effet de dessin — jamais une `<iframe>`.
          // `w-max min-w-full` : une fois zoomé, le contenu dépasse et la zone défile aussi en
          // largeur, au lieu de rogner la page.
          <div ref={contenuRef} className="flex w-max min-w-full flex-col items-center gap-3 p-2" />
        ) : phase === "image" && urlImage ? (
          <div className="flex min-h-full w-max min-w-full items-center justify-center p-2">
            {/* Image de même origine, déjà récupérée en blob, dimensions inconnues à l'avance :
                `next/image` n'apporte rien ici et exige une largeur/hauteur qu'on n'a pas. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urlImage}
              alt={titre}
              style={{ width: `${zoom * 100}%`, maxWidth: zoom > ZOOM_MIN ? "none" : "100%" }}
              className="h-auto rounded bg-white object-contain"
            />
          </div>
        ) : null}
      </div>
      <MessageEtatDocument phase={phase} actions={actions} />
    </div>
  );
}
