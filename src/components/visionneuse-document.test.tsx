import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MessageEtatDocument,
  VisionneuseDocument,
  ZOOM_DOUBLE_TAP,
  ZOOM_MAX,
  ZOOM_MIN,
  bornerZoom,
  decisionFermetureGeste,
  dimensionsCanvasPdf,
  distanceEntrePointeurs,
  estDoubleTap,
  estTap,
  glissementAmorti,
  modeAffichageDocument,
  toucheActionZone,
  zoomApresDoubleTap,
  zoomPince,
} from "./visionneuse-document";

// ─────────────────────────────────────────────────────────────────────────────
// CE DÉPÔT N'A PAS DE DOM EN TEST (`environment: "node"`, vitest.config.ts) : les `useEffect` qui
// pilotent pdf.js, le `<canvas>` et les gestes ne s'exécutent JAMAIS ici. C'est exactement pour ça
// que toutes les DÉCISIONS de la visionneuse (mode d'affichage, dimensions du canvas, zoom,
// fermeture au geste) vivent en fonctions PURES hors du composant : ce fichier les exerce
// réellement, plutôt que de relire le texte du composant.
//
// CE QU'IL NE VÉRIFIE PAS, ET QUE PERSONNE NE PEUT VÉRIFIER ICI : qu'un PDF s'affiche vraiment
// dans la PWA installée sur un iPhone. Seul l'appareil le dira.
// ─────────────────────────────────────────────────────────────────────────────

describe("modeAffichageDocument — le type vient de la route, jamais de l'adresse", () => {
  it("reconnaît un PDF", () => {
    expect(modeAffichageDocument("application/pdf")).toBe("pdf");
  });

  it("n'est sensible ni à la casse ni aux espaces", () => {
    expect(modeAffichageDocument(" APPLICATION/PDF ")).toBe("pdf");
  });

  it("écarte les paramètres du Content-Type, qu'une vraie réponse porte souvent", () => {
    // FALSIFIABLE : sans le `.split(";")[0]`, ces deux-là retombent en "aucun" — la visionneuse
    // refuserait d'afficher un document parfaitement intact.
    expect(modeAffichageDocument("application/pdf; charset=binary")).toBe("pdf");
    expect(modeAffichageDocument("image/jpeg; charset=utf-8")).toBe("image");
  });

  it("reconnaît une image quel que soit son sous-type", () => {
    expect(modeAffichageDocument("image/png")).toBe("image");
    expect(modeAffichageDocument("image/webp")).toBe("image");
  });

  it("ne prétend rien pour un type qui n'est ni PDF ni image", () => {
    expect(modeAffichageDocument("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("aucun");
    expect(modeAffichageDocument("text/html")).toBe("aucun");
  });

  it("ne prétend rien pour un type absent ou vide — jamais de repli « application/pdf » en dur", () => {
    // Un repli en dur ferait échouer l'affichage d'une image ET accuserait un document intact.
    expect(modeAffichageDocument(null)).toBe("aucun");
    expect(modeAffichageDocument(undefined)).toBe("aucun");
    expect(modeAffichageDocument("")).toBe("aucun");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ SANS `devicePixelRatio`, UN PDF EST FLOU SUR TÉLÉPHONE — et montrer un document sans le
// rendre lisible, c'est rater la demande. FALSIFIÉ : en figeant `densite` à 1 dans
// `dimensionsCanvasPdf`, les trois tests DPR ci-dessous tombent.
// ─────────────────────────────────────────────────────────────────────────────
describe("dimensionsCanvasPdf — netteté sur un écran à haute densité", () => {
  it("DPR 1 : les pixels du canvas égalent les pixels CSS", () => {
    const d = dimensionsCanvasPdf(800, 400, 600, 1);
    expect(d.echelle).toBe(2);
    expect(d.largeurCss).toBe(800);
    expect(d.hauteurCss).toBe(1200);
    expect(d.largeurPixels).toBe(800);
    expect(d.hauteurPixels).toBe(1200);
  });

  it("DPR 2 : les pixels DOUBLENT, la taille CSS ne bouge pas", () => {
    const d = dimensionsCanvasPdf(400, 400, 600, 2);
    expect(d.largeurCss).toBe(400);
    expect(d.hauteurCss).toBe(600);
    expect(d.largeurPixels).toBe(800);
    expect(d.hauteurPixels).toBe(1200);
  });

  it("DPR 3 (iPhone Pro) : les pixels TRIPLENT", () => {
    const d = dimensionsCanvasPdf(300, 300, 400, 3);
    expect(d.largeurCss).toBe(300);
    expect(d.largeurPixels).toBe(900);
    expect(d.hauteurPixels).toBe(1200);
  });

  it("un DPR non entier n'invente jamais un canvas fractionnaire", () => {
    const d = dimensionsCanvasPdf(375, 300, 450, 1.5);
    for (const v of [d.largeurPixels, d.hauteurPixels, d.largeurCss, d.hauteurCss]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("un DPR absurde (0, NaN) retombe sur 1 au lieu de produire un canvas vide", () => {
    expect(dimensionsCanvasPdf(400, 400, 600, 0).largeurPixels).toBe(400);
    expect(dimensionsCanvasPdf(400, 400, 600, Number.NaN).largeurPixels).toBe(400);
  });

  it("une largeur disponible de 0 (conteneur encore masqué) ne divise jamais par zéro", () => {
    const d = dimensionsCanvasPdf(0, 400, 600, 2);
    expect(Number.isFinite(d.echelle)).toBe(true);
    expect(d.largeurPixels).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LE PLAFOND : au-delà d'une certaine surface, iOS rend un canvas BLANC — soit exactement le
  // symptôme que cette visionneuse existe pour supprimer. FALSIFIÉ : en retirant la réduction
  // d'échelle, le test ci-dessous monte à 8775 px de haut.
  // ───────────────────────────────────────────────────────────────────────────
  it("plafonne le côté physique du canvas, en gardant la taille CSS intacte", () => {
    // iPhone Pro (DPR 3), zone de 390 px, zoomé ×3, page A4 en points (595 × 842).
    const d = dimensionsCanvasPdf(390 * 3, 595, 842, 3);
    expect(d.hauteurPixels).toBeLessThanOrEqual(4096);
    expect(d.largeurPixels).toBeLessThanOrEqual(4096);
    // La taille CSS, elle, n'est PAS rabotée : la page occupe toujours la place voulue à l'écran.
    expect(d.largeurCss).toBe(1170);
  });

  it("ne plafonne rien quand il n'y a pas lieu", () => {
    const d = dimensionsCanvasPdf(390, 595, 842, 2);
    expect(d.largeurPixels).toBe(780);
    expect(d.hauteurPixels).toBe(1104);
  });
});

describe("zoom — pincer et double-taper, comme dans Aperçu", () => {
  it("le zoom reste entre 1 et 4, quoi qu'il arrive", () => {
    expect(bornerZoom(0.2)).toBe(ZOOM_MIN);
    expect(bornerZoom(99)).toBe(ZOOM_MAX);
    expect(bornerZoom(Number.NaN)).toBe(ZOOM_MIN);
    expect(bornerZoom(2)).toBe(2);
  });

  it("le pincement suit le rapport des distances entre les deux doigts", () => {
    expect(zoomPince(1, 100, 200)).toBe(2);
    expect(zoomPince(2, 200, 100)).toBe(1);
    expect(zoomPince(2, 100, 400)).toBe(ZOOM_MAX); // borné
  });

  it("un pincement dégénéré (doigts confondus) ne renvoie jamais Infinity", () => {
    expect(zoomPince(2, 0, 100)).toBe(2);
    expect(zoomPince(2, 100, 0)).toBe(2);
  });

  it("le double-tap zoome d'un coup, puis dézoome d'un coup", () => {
    expect(zoomApresDoubleTap(ZOOM_MIN)).toBe(ZOOM_DOUBLE_TAP);
    expect(zoomApresDoubleTap(ZOOM_DOUBLE_TAP)).toBe(ZOOM_MIN);
    expect(zoomApresDoubleTap(1.4)).toBe(ZOOM_MIN);
  });

  it("distance entre deux doigts", () => {
    expect(distanceEntrePointeurs({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("deux taps proches et rapprochés dans le temps font un double-tap ; sinon non", () => {
    const premier = { x: 100, y: 100, t: 1000 };
    expect(estDoubleTap(premier, { x: 105, y: 102, t: 1200 })).toBe(true);
    expect(estDoubleTap(premier, { x: 105, y: 102, t: 1600 })).toBe(false); // trop tard
    expect(estDoubleTap(premier, { x: 300, y: 100, t: 1100 })).toBe(false); // trop loin
    expect(estDoubleTap(null, { x: 100, y: 100, t: 1000 })).toBe(false);
  });

  it("un glissement franc n'est pas un tap", () => {
    expect(estTap(2, 3, 120)).toBe(true);
    expect(estTap(2, 300, 120)).toBe(false);
    expect(estTap(2, 3, 2000)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LE ZOOM NE DOIT PAS PIÉGER LE DOIGT. Le fond de la superposition se referme au clic ; un geste
// de zoom (deux doigts) ou un déplacement DANS une page zoomée ne doivent JAMAIS être pris pour
// une fermeture. FALSIFIÉ : en retirant le test `nombrePointeurs !== 1`, le premier cas ci-dessous
// referme au milieu d'un pincement ; en retirant le test sur le zoom, le deuxième referme pendant
// qu'on se déplace dans une page agrandie.
// ─────────────────────────────────────────────────────────────────────────────
describe("decisionFermetureGeste — glisser vers le bas referme, le reste non", () => {
  const base = { dy: 200, dx: 0, dureeMs: 300, zoom: 1, scrollTopDepart: 0, nombrePointeurs: 1 };

  it("un glissement franc vers le bas, en haut du document, referme", () => {
    expect(decisionFermetureGeste(base)).toBe(true);
  });

  it("une détente vive referme même sur une courte distance", () => {
    expect(decisionFermetureGeste({ ...base, dy: 60, dureeMs: 100 })).toBe(true);
  });

  it("un petit glissement hésitant ne referme pas", () => {
    expect(decisionFermetureGeste({ ...base, dy: 40, dureeMs: 800 })).toBe(false);
  });

  it("un pincement (deux doigts) ne referme JAMAIS", () => {
    expect(decisionFermetureGeste({ ...base, nombrePointeurs: 2 })).toBe(false);
  });

  it("zoomé, le glissement déplace la page — il ne referme pas", () => {
    expect(decisionFermetureGeste({ ...base, zoom: 2.5 })).toBe(false);
  });

  it("au milieu du document, le glissement est un défilement — il ne referme pas", () => {
    expect(decisionFermetureGeste({ ...base, scrollTopDepart: 340 })).toBe(false);
  });

  it("un glissement vers le HAUT ne referme pas", () => {
    expect(decisionFermetureGeste({ ...base, dy: -200 })).toBe(false);
  });

  it("un balayage horizontal ne referme pas", () => {
    expect(decisionFermetureGeste({ ...base, dy: 120, dx: 400 })).toBe(false);
  });

  it("le panneau suit le doigt, amorti, et jamais vers le haut", () => {
    expect(glissementAmorti(100)).toBeCloseTo(60);
    expect(glissementAmorti(-100)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `touch-action` : la pièce qui décide qui, du navigateur ou de nous, tient le doigt.
// FALSIFIÉ : en renvoyant toujours "pan-x pan-y", iOS s'empare du glissement vers le bas (rebond
// d'overscroll) et la fermeture ne part jamais — le premier test ci-dessous tombe.
// ─────────────────────────────────────────────────────────────────────────────
describe("toucheActionZone — le navigateur garde le défilement, nous gardons les gestes", () => {
  it("en haut et non zoomé : le geste est à nous (le prochain glissement vers le bas referme)", () => {
    expect(toucheActionZone(1, true)).toBe("none");
  });

  it("dès qu'on a défilé : le défilement natif reprend la main (et son inertie)", () => {
    expect(toucheActionZone(1, false)).toBe("pan-x pan-y");
  });

  it("zoomé : le défilement à deux axes appartient au navigateur, le pincement reste à nous", () => {
    // « pan-x pan-y » n'inclut PAS le jeton `pinch-zoom` : le zoom de page d'iOS ne se déclenche
    // pas, notre propre pincement est le seul à s'exécuter.
    expect(toucheActionZone(2.5, true)).toBe("pan-x pan-y");
    expect(toucheActionZone(2.5, false)).toBe("pan-x pan-y");
  });
});

describe("MessageEtatDocument — jamais un cadre vide, jamais un nouveau geste", () => {
  it("dit que le chargement est en cours", () => {
    const html = renderToStaticMarkup(createElement(MessageEtatDocument, { phase: "chargement" }));
    expect(html).toMatch(/Chargement du document/);
  });

  it("dit l'échec et renvoie aux boutons DÉJÀ présents au-dessus — sans poser de lien", () => {
    const html = renderToStaticMarkup(createElement(MessageEtatDocument, { phase: "echec" }));
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/Télécharger/);
    // Le piège de la sortie de secours posée SOUS le cadre qu'elle devait secourir : un message
    // d'échec ne propose JAMAIS un nouveau geste.
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toMatch(/<button\b/);
  });

  it("pour un type qui ne se dessine pas : un message, et surtout pas un cadre vide", () => {
    const html = renderToStaticMarkup(createElement(MessageEtatDocument, { phase: "aucun" }));
    expect(html).toMatch(/ne s.{1,8}affiche pas ici/);
    expect(html).not.toMatch(/<a\b/);
  });

  it("ne dit rien quand le document est affiché", () => {
    expect(renderToStaticMarkup(createElement(MessageEtatDocument, { phase: "pdf" }))).toBe("");
    expect(renderToStaticMarkup(createElement(MessageEtatDocument, { phase: "image" }))).toBe("");
  });
});

describe("VisionneuseDocument — plus jamais d'<iframe>", () => {
  it("le premier rendu ne pose ni <iframe>, ni <embed>, ni <object>", () => {
    const html = renderToStaticMarkup(
      createElement(VisionneuseDocument, {
        src: "/paie/bulletin/abc?devise=USD",
        titre: "Bulletin — Rachel Lunda",
      }),
    );
    expect(html).not.toMatch(/<iframe/);
    expect(html).not.toMatch(/<embed/);
    expect(html).not.toMatch(/<object/);
    // Et il annonce ce qu'il fait, plutôt que de laisser un cadre muet.
    expect(html).toMatch(/Chargement du document/);
  });
});
