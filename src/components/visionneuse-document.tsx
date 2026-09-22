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
// LA RÈGLE QUI NE BOUGE PAS : « Fermer », « Télécharger » et « Nouvel onglet » vivent AU-DESSUS de
// ce composant et NE DÉPENDENT JAMAIS de ce qu'il rend. Si le dessin échoue (PDF corrompu,
// mémoire, worker inatteignable…), ce composant le DIT et pointe vers ces boutons déjà présents —
// il ne propose JAMAIS un nouveau geste, qui pourrait, lui, enfermer l'utilisateur.
//
// LE TYPE MIME VIENT DE LA ROUTE, JAMAIS DE L'URL. Les routes de PEF (/paie/bulletin/{id},
// /employes/{id}/contrat/{contratId}…) ne portent aucune extension : deviner « .pdf » serait un
// repli en dur qui ferait échouer l'affichage d'une image et ACCUSERAIT un document intact. Le
// composant lit donc le `Content-Type` de la réponse.
//
// UN SEUL ALLER-RETOUR RÉSEAU. Ces routes GÉNÈRENT le PDF à chaque appel (@react-pdf/renderer,
// aucun en-tête de cache) : une requête pour le type puis une seconde pour le contenu le ferait
// fabriquer DEUX fois. On récupère donc le document une fois, en `fetch(…, { credentials:
// "same-origin" })` — la session voyage avec, comme le demande une route protégée — puis on donne
// les OCTETS à pdf.js (`getDocument({ data })`). C'est le seul écart assumé au brief de la tâche,
// qui demandait `getDocument({ url, withCredentials: true })` : avec `data`, `withCredentials` est
// inerte (pdf.js ne fait plus la requête), l'ajouter serait du bruit. La garantie demandée —
// « la session accompagne la requête » — est tenue, plus haut, par le `fetch`.
//
// LE WORKER DE PDFJS EST SERVI PAR L'APPLICATION, JAMAIS UN CDN : `public/pdf.worker.min.mjs`,
// copié depuis `node_modules` par `scripts/copier-worker-pdfjs.mjs` en `postinstall` (jamais écrit
// à la main, jamais commité). Et il est EXCLU du motif de `src/proxy.ts` — sans quoi le garde
// d'authentification répondrait 307 vers /login sur un fichier que le navigateur va chercher tout
// seul (piège déjà refermé trois fois dans cette famille de dépôts ; vérifié par
// src/lib/chemins-publics.test.ts).
//
// pdfjs-dist EN IMPORT PARESSEUX (`await import`), et SEULEMENT pour un PDF : ni son code
// (plusieurs centaines de kilo-octets) ni son worker ne doivent peser sur un écran qui n'affiche
// aucun document.
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
// (le composant, lui, ne s'exécute jamais sous `renderToStaticMarkup` pour la partie `useEffect`)

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
/**
 * Côté maximal, en pixels PHYSIQUES, d'un `<canvas>`.
 *
 * iOS refuse de dessiner au-delà d'une certaine taille de surface et rend alors un canvas VIDE
 * (blanc) — exactement le symptôme que cette visionneuse existe pour supprimer. Sur un téléphone à
 * DPR 3 zoomé ×4, une page A4 dépasserait largement 4096 px. Le plafond dégrade la définition
 * plutôt que de rendre une page blanche : on préfère un document un peu moins net à un document
 * absent.
 */
export const COTE_PIXELS_MAX = 4096;

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

/**
 * `touch-action` de la zone de lecture — la pièce la plus subtile de ce fichier.
 *
 *  • « pan-x pan-y » : le navigateur garde le défilement NATIF (et son inertie, qu'on ne saurait
 *    pas imiter), mais PERD le pincement — le jeton `pinch-zoom` est absent, donc notre propre
 *    gestion du pincement est la seule à s'exécuter, sans lutter contre le zoom de page d'iOS.
 *  • « none » quand on est EN HAUT et non zoomé, c'est-à-dire exactement quand le prochain
 *    glissement vers le bas doit refermer : sinon iOS s'empare du geste (rebond d'« overscroll »)
 *    et envoie un `pointercancel` — la fermeture ne partirait jamais. Dans cet état le défilement
 *    vers le haut est repris à la main (`scrollTop`), ce qui coûte l'inertie SUR CE SEUL GESTE ;
 *    dès qu'on n'est plus en haut, le natif reprend la main.
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
 * LE PLAFOND (`cotePixelsMax`) : au-delà d'une certaine surface, iOS rend un canvas BLANC. On
 * réduit alors l'échelle de dessin SANS toucher à la taille CSS : un peu moins net vaut mieux
 * qu'une page blanche.
 */
export function dimensionsCanvasPdf(
  largeurDisponible: number,
  largeurBase: number,
  hauteurBase: number,
  dpr: number,
  cotePixelsMax: number = COTE_PIXELS_MAX,
): DimensionsCanvasPdf {
  const largeur = Math.max(1, largeurDisponible);
  const base = Math.max(1, largeurBase);
  const echelleCss = largeur / base;
  const densite = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;

  let echelle = echelleCss * densite;
  const cotePhysiqueMax = Math.max(base, Math.max(1, hauteurBase)) * echelle;
  if (cotePixelsMax > 0 && cotePhysiqueMax > cotePixelsMax) {
    echelle = echelle * (cotePixelsMax / cotePhysiqueMax);
  }

  return {
    echelle,
    largeurCss: Math.round(base * echelleCss),
    hauteurCss: Math.round(Math.max(1, hauteurBase) * echelleCss),
    largeurPixels: Math.round(base * echelle),
    hauteurPixels: Math.round(Math.max(1, hauteurBase) * echelle),
  };
}

type Phase = "chargement" | "pdf" | "image" | "aucun" | "echec";

/**
 * Le message d'état, séparé du composant piloté par les effets — testable en lui donnant
 * directement la phase voulue, puisque les `useEffect` ne s'exécutent jamais sous
 * `renderToStaticMarkup`.
 *
 * AUCUN LIEN, AUCUN BOUTON ICI. « Fermer », « Télécharger » et « Nouvel onglet » sont déjà dans
 * l'en-tête de la superposition, au-dessus, et fonctionnent que ce dessin réussisse ou non. Un
 * message d'échec qui proposerait ICI un nouveau geste referait le pari perdant d'une sortie de
 * secours posée SOUS le cadre qu'elle était censée secourir.
 */
export function MessageEtatDocument({ phase }: { phase: Phase }) {
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
        L&apos;affichage a échoué. Utilisez « Télécharger » ou « Nouvel onglet » ci-dessus pour
        consulter le document.
      </p>
    );
  }
  if (phase === "aucun") {
    return (
      <p role="status" className="px-3 py-2 text-center text-xs text-white">
        Ce type de document ne s&apos;affiche pas ici. Utilisez « Télécharger » ci-dessus pour le
        consulter.
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
  className = "",
}: {
  /** Adresse de la route qui sert le document, en `inline` (sans `dl=1`) — celle que l'ancienne
   *  `<iframe>` posait dans son `src`. */
  src: string;
  /** Titre lisible, utilisé comme texte alternatif (image) et comme étiquette de chaque page. */
  titre: string;
  /** Fermeture de la superposition — appelée par le geste « glisser vers le bas ». Absente pour
   *  l'aperçu inline d'ordinateur, qui n'est dans aucune superposition. */
  onFermer?: () => void;
  /** Le panneau de la superposition, qui suit le doigt pendant le glissement de fermeture. Sans
   *  lui le geste marche quand même, il ne s'anime simplement pas. */
  panneauRef?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("chargement");
  const [urlImage, setUrlImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [enHaut, setEnHaut] = useState(true);

  const zoneRef = useRef<HTMLDivElement>(null);
  const contenuRef = useRef<HTMLDivElement>(null);
  // `any` assumé : le type de pdfjs-dist n'est pas importable statiquement sans tirer le module
  // dans le bundle de tous les écrans — ce que l'import paresseux existe précisément pour éviter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const documentRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tachesRef = useRef<any[]>([]);
  const generationRef = useRef(0);

  const pointeursRef = useRef(new Map<number, { x: number; y: number }>());
  const pinceRef = useRef<{ distanceDepart: number; zoomDepart: number } | null>(null);
  const glissRef = useRef<{ x: number; y: number; t: number; scrollTopDepart: number; nombreMax: number } | null>(null);
  const dernierTapRef = useRef<Tap | null>(null);

  // ── Récupération du document : UNE requête, qui donne à la fois le type réel et les octets ──
  useEffect(() => {
    let annule = false;
    let urlObjet: string | null = null;

    // Aucune remise à zéro synchrone ici (`setPhase("chargement")`…) : les quatre appelants posent
    // un `key` construit sur `src`, donc un document différent REMONTE le composant, qui repart
    // de son état initial. Poser l'état depuis le corps de l'effet ne ferait qu'ajouter un rendu
    // en cascade pour un cas qui ne se produit pas.
    (async () => {
      try {
        const reponse = await fetch(src, { credentials: "same-origin" });
        if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);

        // Le type RÉEL, tel que la route l'annonce — jamais déduit de l'adresse.
        const mode = modeAffichageDocument(reponse.headers.get("Content-Type"));
        if (mode === "aucun") {
          if (!annule) setPhase("aucun");
          return;
        }

        const blob = await reponse.blob();
        if (annule) return;

        if (mode === "image") {
          urlObjet = URL.createObjectURL(blob);
          setUrlImage(urlObjet);
          setPhase("image");
          return;
        }

        const octets = new Uint8Array(await blob.arrayBuffer());
        if (annule) return;

        // Import paresseux : pdfjs-dist ne charge JAMAIS pour une image, un type inconnu, ou
        // n'importe quel autre écran de l'application.
        const pdfjs = await import("pdfjs-dist");
        if (annule) return;
        // JAMAIS un CDN : notre propre fichier statique, copié en `postinstall`.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjs.getDocument({ data: octets }).promise;
        if (annule) {
          doc.destroy();
          return;
        }
        documentRef.current = doc;
        setPhase("pdf");
      } catch {
        // Corrompu, mémoire, worker inatteignable, session expirée… peu importe la cause : on le
        // DIT, et les boutons de l'en-tête restent utilisables au-dessus.
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

    try {
      for (let numero = 1; numero <= doc.numPages; numero += 1) {
        if (generation !== generationRef.current) return;
        const page = await doc.getPage(numero);
        if (generation !== generationRef.current) return;

        const base = page.getViewport({ scale: 1 });
        const dims = dimensionsCanvasPdf(largeurCible, base.width, base.height, dpr);

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

  // Rotation de l'écran / redimensionnement de la fenêtre : la largeur disponible change, il faut
  // redessiner. Sans cela, un iPhone tourné en paysage garderait des pages à la largeur du portrait.
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

  function onPointerDown(e: PointerEventReact<HTMLDivElement>) {
    const pointeurs = pointeursRef.current;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointeurs.size === 2) {
      const [a, b] = [...pointeurs.values()];
      pinceRef.current = { distanceDepart: distanceEntrePointeurs(a, b), zoomDepart: zoom };
      // Un pincement n'est jamais une fermeture ni un tap.
      glissRef.current = null;
      dernierTapRef.current = null;
      reposerPanneau(false);
      return;
    }

    if (pointeurs.size === 1) {
      glissRef.current = {
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        scrollTopDepart: zoneRef.current?.scrollTop ?? 0,
        nombreMax: 1,
      };
    }
  }

  function onPointerMove(e: PointerEventReact<HTMLDivElement>) {
    const pointeurs = pointeursRef.current;
    if (!pointeurs.has(e.pointerId)) return;
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const gliss = glissRef.current;
    if (gliss) gliss.nombreMax = Math.max(gliss.nombreMax, pointeurs.size);

    // Pincer pour zoomer.
    if (pointeurs.size >= 2 && pinceRef.current) {
      const [a, b] = [...pointeurs.values()];
      setZoom(zoomPince(pinceRef.current.zoomDepart, pinceRef.current.distanceDepart, distanceEntrePointeurs(a, b)));
      return;
    }

    if (!gliss || pointeurs.size !== 1) return;

    const zone = zoneRef.current;
    // En dehors de l'état « en haut, non zoomé », le défilement appartient au navigateur : on ne
    // touche à rien (c'est lui qui a l'inertie).
    if (!zone || toucheActionZone(zoom, enHaut) !== "none") return;

    const dy = e.clientY - gliss.y;
    if (dy < 0) {
      // Défilement vers le bas du document, repris à la main le temps de ce geste (cf.
      // `toucheActionZone`).
      zone.scrollTop = gliss.scrollTopDepart - dy;
      reposerPanneau(false);
      return;
    }
    // Glisser vers le bas : le panneau suit le doigt, amorti.
    const panneau = panneauRef?.current;
    if (panneau && dy > 0) {
      // Idem : le suivi du doigt se joue sur le DOM, pas par un rendu React.
      // eslint-disable-next-line react-hooks/immutability -- mutation d'un élément DOM, pas d'une prop
      panneau.style.transition = "";
      panneau.style.transform = `translateY(${glissementAmorti(dy)}px)`;
    }
  }

  function onPointerUp(e: PointerEventReact<HTMLDivElement>) {
    const pointeurs = pointeursRef.current;
    const gliss = glissRef.current;
    const nombreAvant = pointeurs.size;
    pointeurs.delete(e.pointerId);

    if (pointeurs.size < 2) pinceRef.current = null;
    if (nombreAvant >= 2 || !gliss) {
      // Fin d'un pincement : on garde le zoom, on ne referme pas, et le prochain tap repart de zéro.
      if (pointeurs.size === 0) {
        glissRef.current = null;
        dernierTapRef.current = null;
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
      zoom: zoom,
      scrollTopDepart: gliss.scrollTopDepart,
      nombrePointeurs: gliss.nombreMax,
    });
    if (fermer && onFermer) {
      reposerPanneau(false);
      onFermer();
      return;
    }
    reposerPanneau(true);

    // Double-tap pour zoomer / dézoomer d'un coup.
    if (gliss.nombreMax === 1 && estTap(dx, dy, dureeMs)) {
      const tap: Tap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (estDoubleTap(dernierTapRef.current, tap)) {
        dernierTapRef.current = null;
        setZoom((actuel) => zoomApresDoubleTap(actuel));
      } else {
        dernierTapRef.current = tap;
      }
    }
  }

  function onPointerCancel(e: PointerEventReact<HTMLDivElement>) {
    pointeursRef.current.delete(e.pointerId);
    if (pointeursRef.current.size < 2) pinceRef.current = null;
    if (pointeursRef.current.size === 0) {
      glissRef.current = null;
      reposerPanneau(true);
    }
  }

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
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
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
      <MessageEtatDocument phase={phase} />
    </div>
  );
}
