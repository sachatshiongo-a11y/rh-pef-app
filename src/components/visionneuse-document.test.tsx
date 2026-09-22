import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BUDGET_PIXELS_TOTAL,
  COTE_PIXELS_MAX,
  EVENEMENTS_FIN_POINTEUR,
  MessageEtatDocument,
  VisionneuseDocument,
  ZOOM_DOUBLE_TAP,
  ZOOM_MAX,
  ZOOM_MIN,
  avancerGeste,
  bornerZoom,
  budgetSurfaceParPage,
  commencerGeste,
  decisionFermetureGeste,
  dimensionsCanvasPdf,
  distanceEntrePointeurs,
  echelleProvisoire,
  estDoubleTap,
  estTap,
  glissementAmorti,
  modeAffichageDocument,
  modeGesteAuContact,
  phraseActions,
  poserPolyfillWithResolvers,
  positionAncree,
  recupererDocument,
  toucheActionZone,
  translationPince,
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
  // d'échelle, le test ci-dessous monte à 4967 px de haut.
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

// ─────────────────────────────────────────────────────────────────────────────
// RELECTURE DU 2026-09-22 — LES CINQ DÉFAUTS TROUVÉS, ET CE QUI LES ATTRAPE.
// ─────────────────────────────────────────────────────────────────────────────

describe("1. le défilement ne se fige plus au premier geste, en haut du document", () => {
  it("le mode du geste est décidé au CONTACT, sur le scrollTop réel et le zoom du moment", () => {
    expect(modeGesteAuContact(1, 0)).toBe("nous");
    expect(modeGesteAuContact(1, 8), "on a déjà défilé : le natif garde la main").toBe("navigateur");
    expect(modeGesteAuContact(2.5, 0), "zoomé : le glissement déplace la page").toBe("navigateur");
  });

  it("BLOQUANT — le doigt ne se bloque plus après ~8 px", () => {
    // LE DÉFAUT : la décision était reprise à chaque mouvement, à partir de l'état React « en
    // haut ». Défiler à la main faisait aussitôt passer « en haut » à faux, donc le mouvement
    // suivant ne faisait plus rien : le doigt avançait d'environ 8 px puis se bloquait jusqu'à ce
    // qu'on le lève — au tout premier geste de chaque consultation.
    // FALSIFIÉ : en faisant recalculer le mode dans `avancerGeste` à partir de la position
    // courante (`modeGesteAuContact(geste.zoomDepart, geste.scrollTopDepart - dy)`), seule la
    // première étape passe et les trois suivantes retombent sur « rien ».
    const geste = commencerGeste({ x: 100, y: 400, t: 0, zoom: 1, scrollTop: 0 });
    expect(geste.mode).toBe("nous");

    const parcours = [-8, -40, -120, -300].map((dy) => avancerGeste(geste, dy, 1));
    expect(parcours).toEqual([
      { type: "defiler", scrollTop: 8 },
      { type: "defiler", scrollTop: 40 },
      { type: "defiler", scrollTop: 120 },
      { type: "defiler", scrollTop: 300 },
    ]);
  });

  it("vers le bas, en haut du document : le panneau suit le doigt (c'est la fermeture qui s'arme)", () => {
    const geste = commencerGeste({ x: 100, y: 400, t: 0, zoom: 1, scrollTop: 0 });
    expect(avancerGeste(geste, 100, 1)).toEqual({ type: "suivreLeDoigt", translation: 60 });
  });

  it("un geste commencé ailleurs qu'en haut, ou zoomé, laisse tout au navigateur", () => {
    const enCours = commencerGeste({ x: 100, y: 400, t: 0, zoom: 1, scrollTop: 340 });
    expect(avancerGeste(enCours, -40, 1)).toEqual({ type: "rien" });
    const zoome = commencerGeste({ x: 100, y: 400, t: 0, zoom: 2.5, scrollTop: 0 });
    expect(avancerGeste(zoome, -40, 1)).toEqual({ type: "rien" });
  });

  it("un deuxième doigt suspend immédiatement le geste à un doigt", () => {
    const geste = commencerGeste({ x: 100, y: 400, t: 0, zoom: 1, scrollTop: 0 });
    expect(avancerGeste(geste, -40, 2)).toEqual({ type: "rien" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LE PLAFOND PROTÈGE LA SOMME DES PAGES, PAS UNE PAGE. Toutes les pages sont dessinées ET
// conservées à la fois ; iOS purge les surfaces et les rend BLANCHES quand le total est trop gros.
// FALSIFIÉ : en retirant la réduction par la surface dans `dimensionsCanvasPdf`, le premier test
// ci-dessous monte à ≈ 178 Mo ; en remplaçant `budgetSurfaceParPage` par le budget total (donc un
// plafond PAR PAGE au lieu du cumul), il monte à ≈ 192 Mo. Les deux sont bien au-dessus du budget.
// ─────────────────────────────────────────────────────────────────────────────
describe("2. le budget de mémoire vaut pour TOUTES les pages conservées", () => {
  /** Le cas mesuré par la relecture : contrat de 4 pages, iPhone Pro (DPR 3), zone 390 px,
   *  double-tapé (×2,5) — c'est-à-dire un geste ordinaire sur un document ordinaire. */
  function pixelsCumules(nombrePages: number, surfaceParPage: number): number {
    let total = 0;
    for (let i = 0; i < nombrePages; i += 1) {
      const d = dimensionsCanvasPdf((390 - 16) * 2.5, 595, 842, 3, COTE_PIXELS_MAX, surfaceParPage);
      total += d.largeurPixels * d.hauteurPixels;
    }
    return total;
  }

  it("un contrat de 4 pages double-tapé reste dans le budget", () => {
    const total = pixelsCumules(4, budgetSurfaceParPage(4));
    expect(total).toBeLessThanOrEqual(BUDGET_PIXELS_TOTAL * 1.02);
    // 4 octets par pixel (RGBA) : environ 48 Mo, contre les ≈ 180 Mo d'avant ce plafond.
    expect(total * 4).toBeLessThan(55_000_000);
  });

  it("le budget se divise bien par le nombre de pages", () => {
    expect(budgetSurfaceParPage(1)).toBe(BUDGET_PIXELS_TOTAL);
    expect(budgetSurfaceParPage(4)).toBe(BUDGET_PIXELS_TOTAL / 4);
    expect(budgetSurfaceParPage(0), "un document sans page ne divise jamais par zéro").toBe(BUDGET_PIXELS_TOTAL);
  });

  it("un document long est dessiné moins fin, mais AUCUNE page n'est blanche", () => {
    // 12 pages : chaque page reçoit un douzième du budget, et garde une taille CSS intacte.
    const d = dimensionsCanvasPdf((390 - 16) * 2.5, 595, 842, 3, COTE_PIXELS_MAX, budgetSurfaceParPage(12));
    expect(d.largeurPixels).toBeGreaterThan(0);
    expect(d.hauteurPixels).toBeGreaterThan(0);
    expect(d.largeurPixels * d.hauteurPixels).toBeLessThanOrEqual(budgetSurfaceParPage(12) * 1.02);
    expect(d.largeurCss).toBe(935); // la place occupée à l'écran ne dépend pas du budget
  });

  it("sans ce budget, le cumul mesuré dépassait 150 Mo — c'est le défaut, écrit noir sur blanc", () => {
    const sansPlafondDeSurface = pixelsCumules(4, Number.POSITIVE_INFINITY);
    expect(sansPlafondDeSurface * 4).toBeGreaterThan(150_000_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LE PINCEMENT SUIT LES DOIGTS. « À la manière de l'application d'aperçu sur iPhone » : une
// page qui ne bouge pas pendant tout le geste puis saute 90 ms après ne tient pas la promesse.
// FALSIFIÉ : en faisant renvoyer 1 à `echelleProvisoire`, la page ne bouge plus du geste et les
// deux premiers tests tombent ; en faisant renvoyer `scrollDepart` à `positionAncree`, on perd la
// ligne lue et le test d'ancrage tombe.
// ─────────────────────────────────────────────────────────────────────────────
describe("3. pincer donne un retour visuel immédiat, et n'égare pas la ligne lue", () => {
  it("l'échelle provisoire suit les doigts pendant le geste", () => {
    expect(echelleProvisoire(2.5, 1)).toBe(2.5);
    expect(echelleProvisoire(2, 4)).toBe(0.5);
  });

  it("elle ne vaut 1 que si le zoom n'a pas bougé — sinon la page resterait figée", () => {
    expect(echelleProvisoire(2, 2)).toBe(1);
    expect(echelleProvisoire(2.5, 1)).not.toBe(1);
    expect(echelleProvisoire(Number.NaN, 1)).toBe(1);
    expect(echelleProvisoire(2, 0)).toBe(1);
  });

  it("le point sous les doigts reste sous les doigts après le zoom", () => {
    // On lit une ligne à 300 px du haut de la zone, déjà 200 px plus bas dans le document.
    // Ce point est à 500 px du haut du contenu ; après un ×2 il est à 1000, donc le défilement
    // doit valoir 1000 − 300 = 700 pour le laisser exactement où il était.
    expect(positionAncree(2, 200, 300, 300)).toBe(700);
    // Les doigts se sont aussi déplacés vers le haut pendant le pincement : on suit.
    expect(positionAncree(2, 200, 300, 100)).toBe(900);
  });

  it("le défilement ne devient jamais négatif", () => {
    expect(positionAncree(0.5, 0, 100, 400)).toBe(0);
  });

  it("la translation du geste place le contenu exactement là où le défilement le mettra ensuite", () => {
    // La cohérence entre le PENDANT (translation) et l'APRÈS (défilement) : c'est elle qui évite
    // le saut au relâchement.
    const [rapport, scroll, ancre] = [2, 200, 300];
    expect(translationPince(rapport, scroll, ancre, ancre)).toBe(scroll - positionAncree(rapport, scroll, ancre, ancre));
  });
});

describe("4. le contrôle du worker au moment du build", () => {
  it("`prebuild` exige le worker, `postinstall` reste indulgent", async () => {
    const { decisionCopie } = await import("../../scripts/copier-worker-pdfjs.mjs");
    // Installation incomplète : on ne casse pas `npm install` pour ça.
    expect(decisionCopie({ source: null, exiger: false })).toMatchObject({ action: "abandonner", code: 0 });
    // Build : c'est le dernier endroit où échouer est utile. Sans ce 1, un bundle SANS worker
    // partirait en production et la visionneuse serait cassée sur les téléphones.
    // FALSIFIÉ : en renvoyant toujours 0, ce test tombe.
    expect(decisionCopie({ source: null, exiger: true })).toMatchObject({ action: "abandonner", code: 1 });
    expect(decisionCopie({ source: "/chemin/pdf.worker.min.mjs", exiger: true })).toMatchObject({
      action: "copier",
      code: 0,
    });
  });

  it("le dépôt appelle bien le script en mode exigeant avant le build", async () => {
    const pkg = await import("../../package.json");
    expect(pkg.default.scripts.prebuild).toContain("--exiger");
    expect(pkg.default.scripts.postinstall).not.toContain("--exiger");
  });
});

describe("5. les petits pièges qui cassent tout en silence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("une fin de pointeur PERDUE est écoutée comme les autres", () => {
    // Sans `lostpointercapture`, un `pointerup` tactile égaré laisse une entrée fantôme : tout
    // toucher ultérieur compte pour deux doigts, le zoom saute et « glisser pour refermer » ne
    // s'arme plus jamais. Le composant boucle sur CETTE liste : en retirer un le débranche.
    // FALSIFIÉ : en retirant "lostpointercapture" de la constante, ce test tombe.
    expect([...EVENEMENTS_FIN_POINTEUR]).toEqual(["pointerup", "pointercancel", "lostpointercapture"]);
  });

  it("un réseau qui ne répond jamais finit par ÉCHOUER, au lieu de charger indéfiniment", { timeout: 2000 }, async () => {
    // FALSIFIÉ : en retirant l'AbortController de `recupererDocument`, la promesse ne se règle
    // jamais et ce test tombe en dépassement de délai.
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) =>
      new Promise((_resolu, rejete) => {
        init.signal?.addEventListener("abort", () => rejete(new Error("annulé")));
      }),
    );
    await expect(recupererDocument("/paie/bulletin/abc", 30)).rejects.toThrow();
  });

  it("une réponse en erreur ne passe jamais pour un document", async () => {
    vi.stubGlobal("fetch", async () => new Response("interdit", { status: 403 }));
    await expect(recupererDocument("/paie/bulletin/abc", 500)).rejects.toThrow(/403/);
  });

  it("une réponse correcte rend le type RÉEL et les octets, en une seule requête", async () => {
    let appels = 0;
    vi.stubGlobal("fetch", async () => {
      appels += 1;
      return new Response(new Blob(["%PDF-1.7"]), { headers: { "Content-Type": "application/pdf" } });
    });
    const { mime, blob } = await recupererDocument("/paie/bulletin/abc", 500);
    expect(mime).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(0);
    // Ces routes FABRIQUENT le PDF à chaque appel : deux requêtes le produiraient deux fois.
    expect(appels).toBe(1);
  });

  it("`Promise.withResolvers` est posé quand il manque, et jamais écrasé quand il existe", async () => {
    // pdfjs 5.x s'en sert 31 fois, et Next ne transpile pas `node_modules` : sans ce polyfill,
    // AUCUN document ne s'affiche sous iOS 17.4.
    // FALSIFIÉ : en faisant renvoyer `false` sans rien poser, les deux premières attentes tombent.
    const vieuxMoteur: { withResolvers?: unknown } = {};
    expect(poserPolyfillWithResolvers(vieuxMoteur)).toBe(true);
    expect(typeof vieuxMoteur.withResolvers).toBe("function");

    const pose = vieuxMoteur.withResolvers as <T>() => {
      promise: Promise<T>;
      resolve: (v: T) => void;
      reject: (r?: unknown) => void;
    };
    const { promise, resolve } = pose<string>();
    resolve("vu");
    await expect(promise).resolves.toBe("vu");

    const origine = () => ({});
    const moteurRecent = { withResolvers: origine };
    expect(poserPolyfillWithResolvers(moteurRecent)).toBe(false);
    expect(moteurRecent.withResolvers, "un moteur récent garde SA version").toBe(origine);
  });

  it("le message d'échec ne cite que les boutons RÉELLEMENT présents chez l'appelant", () => {
    // FALSIFIÉ : en réécrivant la phrase en dur (« Télécharger » ou « Nouvel onglet »), la
    // première attente tombe — on enverrait l'utilisateur de l'aperçu d'ordinateur vers un bouton
    // qui n'existe pas dans sa barre.
    const inline = renderToStaticMarkup(
      createElement(MessageEtatDocument, { phase: "echec", actions: ["Télécharger", "Agrandir"] }),
    );
    expect(inline).not.toMatch(/Nouvel onglet/);
    expect(inline).toMatch(/Agrandir/);

    const pleinEcran = renderToStaticMarkup(
      createElement(MessageEtatDocument, { phase: "echec", actions: ["Télécharger", "Nouvel onglet"] }),
    );
    expect(pleinEcran).toMatch(/Nouvel onglet/);
  });

  it("la phrase des actions se lit comme une phrase", () => {
    expect(phraseActions(["Télécharger"])).toBe("« Télécharger »");
    expect(phraseActions(["Télécharger", "Agrandir"])).toBe("« Télécharger » ou « Agrandir »");
    expect(phraseActions(["A", "B", "C"])).toBe("« A », « B » ou « C »");
    expect(phraseActions([]), "jamais une phrase bancale").toBe("les boutons ci-dessus");
    expect(phraseActions(["  "])).toBe("les boutons ci-dessus");
  });
});
