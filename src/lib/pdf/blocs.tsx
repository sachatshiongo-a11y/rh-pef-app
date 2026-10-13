import { Fragment, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Document, Page } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";

/**
 * RENDU PAR BLOCS DES PDF LONGS (13/10/2026).
 *
 * LE DÉFAUT (production, 13/10/2026) : le PDF « Inventaire + mouvements » de septembre faisait échouer le contrôle de
 * santé de Render (« timed out after 5 seconds ») puis redémarrer l'instance. Cause mesurée : ce n'est pas la mémoire
 * mais le BLOCAGE de la boucle d'événements. Pour couper un tableau en pages, react-pdf reprend la mise en page de
 * TOUT le reste du tableau à chaque page, et son découpage parcourt les nœuds restants un à un pour chacun
 * (`nodes.slice(i + 1)` dans `splitNodes`) : le coût croît comme le CARRÉ du nombre de lignes, d'un seul bloc, sans que
 * la boucle puisse respirer (500 lignes = 2,7 s, 1 500 lignes = 25 s en local ; l'instance gratuite est ~10 fois plus lente).
 *
 * LE REMÈDE : rendre le document par FENÊTRES de deux pages (~80 lignes, un petit document à la fois, libéré avant le
 * suivant), réunies avec pdf-lib, en rendant la main (`setImmediate`) entre deux fenêtres. Le blocage est celui d'une
 * fenêtre, pas du document. Trois précautions rendent le résultat identique à un rendu d'un seul tenant (vérifié page
 * par page, position par position, par `blocs.render.test.ts`) :
 *
 *  1. Aucune page à moitié vide aux jonctions. Chaque fenêtre est rendue un peu plus longue que nécessaire ; la mise
 *     en page dit quelle « place » ouvre sa DERNIÈRE page (repère `data-i`, lu via `onRender`) ; cette dernière page est
 *     écartée et la fenêtre suivante reprend à cette place. Seules des pages COMPLÈTES sont gardées. (Seule la dernière
 *     page d'une fenêtre peut différer d'un rendu d'un seul tenant : une exigence de place, `minPresenceAhead`, ne se
 *     relâche que lorsque la fenêtre finit sur cette page.)
 *  2. Ce qui reprend en début de fenêtre (tableau, section) n'a ni marge ni trait de tête, comme la suite d'un bloc
 *     coupé par react-pdf (`splitNode` : marginTop, paddingTop et borderTopWidth à 0) : paramètre `suite`.
 *  3. « Page x sur y » : le pied de page n'est PAS dessiné par les fenêtres (leur numérotation ne serait que locale).
 *     Il est posé à la fin par un petit document de N pages ne contenant que ce pied, rendu par le même composant
 *     (même police, même place, numérotation native de react-pdf sur N pages), superposé page à page.
 *
 * VOCABULAIRE. Un document est une suite de GROUPES (une <Page> d'origine chacun, qui peut occuper plusieurs pages),
 * eux-mêmes faits de PIÈCES (bandeau de tête, tableau…). Les pièces se partagent une numérotation continue de
 * « places » (une place = une ligne, un titre, un bloc de tête) ; une fenêtre est une plage de places [debut, fin).
 * Le document d'un seul tenant est la fenêtre [0, total) : UN SEUL chemin de mise en page pour les deux rendus.
 */

/**
 * Pages gardées par fenêtre. Une fenêtre est dimensionnée pour en remplir ce nombre PLUS une marge de quelques places,
 * dont la dernière page (écartée, puis refaite par la fenêtre suivante) ne contient presque que la marge : peu de travail jeté.
 * Le coût d'une fenêtre croît comme le carré de sa taille (voir plus haut) : on reste à deux pages. Mesuré (600 lignes, même
 * temps total pour 1 à 4 pages) : plus long blocage 0,09 s à 1 page, 0,16 s à 2, 0,24 s à 3, 0,35 s à 4 ; taille du fichier 1,3 Mo à 1
 * page, 0,77 Mo à 2, 0,56 Mo à 3 (chaque fenêtre embarque son sous-ensemble de police et le logo).
 */
export const PAGES_PAR_FENETRE = 2;

/** Places de marge au-delà des pages visées : de quoi couvrir les exigences de place (`minPresenceAhead`, ≤ 3 rangées) de la dernière page gardée. */
export const MARGE_FENETRE = 8;

/** Places d'une fenêtre tant qu'on ne sait pas combien une page en tient (~40 en portrait, ~27 en paysage). */
export const PLACES_PAR_PAGE_INITIAL = 36;

/** Jusqu'à ce nombre de places (la taille d'une fenêtre), le document est rendu d'un seul tenant : inchangé, sans fusion ni pied superposé. */
export const SEUIL_PLACES_BLOCS = 80;

/** Bulletins (ou autres pages indépendantes) rendus ensemble, dans `Plan.lots` : un lot, puis la main est rendue. */
export const PAGES_PAR_LOT = 2;

/** Ce qu'une pièce doit poser pour la fenêtre demandée. */
export type Coupe = {
  /** Places LOCALES de la pièce à rendre : [de, a), bornées à [0, places] ; vide (de ≥ a) = rien de la pièce dans la fenêtre. */
  de: number;
  a: number;
  /** Place GLOBALE de la place locale 0 (sert à poser les repères). */
  base: number;
  /** Ce n'est pas le premier morceau de la pièce (elle a commencé plus haut) : ni marge ni trait de tête. */
  suite: boolean;
  /** Pose des repères `data-i` : seulement pour le rendu par fenêtres (lus par le moteur pour couper aux limites de page). */
  repere: (local: number) => { "data-i"?: number };
};

export type Piece = {
  /** Nombre de places que la pièce occupe dans la numérotation du document (≥ 1). */
  places: number;
  /** Éléments de la pièce pour cette coupe ; `null` si rien n'est à poser (les éléments `fixed` se posent même sur une fenêtre de suite). */
  rendre: (c: Coupe) => ReactNode;
};

export type Groupe = {
  /** Posé en tête de CHAQUE page du groupe (`fixed`) : en-tête de marque. */
  entete?: ReactNode;
  pieces: Piece[];
  /** Posé après la dernière pièce, quand la fenêtre atteint la fin du groupe (mention de bas de partie). */
  fin?: ReactNode;
  /** Pied de page de marque propre à ce groupe (sinon celui du plan) : une fiche, un libellé. */
  pied?: ReactNode;
};

type StylePage = ComponentProps<typeof Page>["style"];

export type Plan = {
  mode: "fenetres";
  groupes: Groupe[];
  page: { orientation: "portrait" | "landscape"; style: StylePage };
  /** Pied de page de marque, FIXE : « Page x sur y ». Posé sur chaque page du document d'un seul tenant ; le rendu par blocs le pose à la fin. */
  pied: ReactNode;
  /** Nombre de places du document (somme des places de ses pièces). */
  places: number;
  /** Titre du document (métadonnées du PDF), s'il en a un. */
  titre?: string;
};

/** Document de pages INDÉPENDANTES (bulletins : une page par salarié) : rendu par lots de pages, sans repères ni fenêtre. */
export type PlanLots = {
  mode: "lots";
  /** Nombre de pages (une par élément). */
  pages: number;
  /** Document des éléments [de, a). */
  lot: (de: number, a: number) => ReactElement<DocumentProps>;
};

// ---- Registre : relie un <Document/> construit à son plan, pour que `renderPdfBuffer` sache le découper. -------------

const registre = new WeakMap<object, Plan | PlanLots>();

export function declarerPlan<T extends ReactElement<DocumentProps>>(document: T, plan: Plan | PlanLots): T {
  registre.set(document, plan);
  return document;
}

export function planDe(document: object): Plan | PlanLots | undefined {
  return registre.get(document);
}

// ---- Construction des documents ---------------------------------------------------------------------------------------

const borne = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Intervalle de places [debut, fin) de chaque groupe. */
function etendues(plan: Plan): { debut: number; fin: number; pieces: { debut: number; piece: Piece }[] }[] {
  let n = 0;
  return plan.groupes.map((g) => {
    const debut = n;
    const pieces = g.pieces.map((piece) => { const d = n; n += piece.places; return { debut: d, piece }; });
    return { debut, fin: n, pieces };
  });
}

export function totalPlaces(groupes: Groupe[]): number {
  return groupes.reduce((n, g) => n + g.pieces.reduce((m, p) => m + p.places, 0), 0);
}

type OptionsDocument = {
  debut: number;
  fin: number;
  /** Poser les repères `data-i` et appeler `aLaFin` avec ceux de chaque page. */
  reperes?: (parPage: (number | undefined)[]) => void;
  /** Poser le pied de page de marque sur chaque page. */
  pied: boolean;
};

/** La fenêtre [debut, fin) du document : mêmes composants que le document d'un seul tenant. */
export function documentFenetre(plan: Plan, o: OptionsDocument): ReactElement<DocumentProps> {
  const marquer = o.reperes !== undefined;
  const pages = etendues(plan).flatMap((g, gi) => {
    if (g.fin <= o.debut || g.debut >= o.fin) return []; // ce groupe est entièrement hors de la fenêtre
    const groupe = plan.groupes[gi];
    return [
      <Page key={gi} size="A4" orientation={plan.page.orientation} style={plan.page.style}>
        {groupe.entete}
        {g.pieces.map(({ debut, piece }, pi) => {
          const de = borne(o.debut - debut, 0, piece.places);
          const a = borne(o.fin - debut, 0, piece.places);
          const contenu = piece.rendre({
            de, a, base: debut, suite: de >= 1,
            repere: (local) => (marquer ? { "data-i": debut + local } : {}),
          });
          return <Fragment key={pi}>{contenu}</Fragment>;
        })}
        {o.fin >= g.fin ? groupe.fin : null}
        {o.pied ? (groupe.pied ?? plan.pied) : null}
      </Page>,
    ];
  });
  return <Document title={plan.titre} onRender={marquer ? (p) => o.reperes!(reperesParPage(p)) : undefined}>{pages}</Document>;
}

/**
 * Document de N pages ne portant que le pied de page de marque : « Page x sur N » exact. `groupes[i]` : le groupe dont la
 * page i fait partie (son pied propre, s'il en a un).
 */
function documentPieds(plan: Plan, groupes: number[]): ReactElement<DocumentProps> {
  return (
    <Document>
      {groupes.map((gi, i) => (
        <Page key={i} size="A4" orientation={plan.page.orientation} style={plan.page.style}>
          {plan.groupes[gi].pied ?? plan.pied}
        </Page>
      ))}
    </Document>
  );
}

/** Plus petit repère `data-i` de l'arbre de mise en page d'une page ; undefined si la page n'en porte aucun. */
type Noeud = { props?: Record<string, unknown>; children?: Noeud[] };
function plusPetitRepere(n: Noeud): number | undefined {
  let min = typeof n.props?.["data-i"] === "number" ? (n.props["data-i"] as number) : undefined;
  for (const c of n.children ?? []) {
    const m = plusPetitRepere(c);
    if (m !== undefined && (min === undefined || m < min)) min = m;
  }
  return min;
}
function reperesParPage(onRenderProps: unknown): (number | undefined)[] {
  const noeud = (onRenderProps as { _INTERNAL__LAYOUT__DATA_?: Noeud })._INTERNAL__LAYOUT__DATA_;
  return (noeud?.children ?? []).map(plusPetitRepere);
}

/** Le document d'un seul tenant d'un plan (fenêtre [0, total), pied compris) ; enregistre le plan pour `renderPdfBuffer`. */
export function documentDuPlan(plan: Plan): ReactElement<DocumentProps> {
  return declarerPlan(documentFenetre(plan, { debut: 0, fin: plan.places, pied: true }), plan);
}

// ---- Moteur -----------------------------------------------------------------------------------------------------------

type Rendu = (document: ReactElement<DocumentProps>) => Promise<Buffer>;

/** Rend la main à la boucle d'événements : contrôle de santé de la plateforme et autres requêtes passent entre deux blocs. */
export const respirer = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Rend `plan` par fenêtres et les réunit. `rendre` rend UN document (rechargement des polices compris). */
export async function rendreParBlocs(plan: Plan, rendre: Rendu): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const reuni = await PDFDocument.create();
  if (plan.titre) reuni.setTitle(plan.titre);
  const zones = etendues(plan);
  const groupeDeLaPlace = (place: number) => Math.max(0, zones.findIndex((z) => place < z.fin));
  const groupeDePage: number[] = []; // groupe de chaque page gardée, pour son pied de page
  let debut = 0;
  let parPage = PLACES_PAR_PAGE_INITIAL; // places qu'une page porte, relu à chaque fenêtre
  let elargissement = 1; // double quand une fenêtre tient sur une seule page (lignes très hautes)
  while (debut < plan.places) {
    const taille = Math.ceil(PAGES_PAR_FENETRE * parPage * elargissement) + MARGE_FENETRE;
    const fin = Math.min(plan.places, debut + taille);
    const dernier = fin >= plan.places;
    let reperes: (number | undefined)[] = [];
    const brut = await rendre(documentFenetre(plan, { debut, fin, pied: false, reperes: (r) => { reperes = r; } }));
    const fenetre = await PDFDocument.load(brut);
    const nb = fenetre.getPageCount();
    let garder = nb;
    let suite = fin;
    if (!dernier) {
      const repere = reperes[nb - 1];
      if (nb < 2 || repere === undefined || repere <= debut) {
        elargissement *= 2; // la fenêtre tient sur une page : trop courte pour couper proprement, on l'élargit
        await respirer();
        continue;
      }
      garder = nb - 1; // la dernière page (peut-être à moitié pleine) est refaite par la fenêtre suivante
      suite = repere;
    }
    for (const page of await reuni.copyPages(fenetre, Array.from({ length: garder }, (_, i) => i))) reuni.addPage(page);
    // Groupe de chaque page gardée : celui de son premier repère (une page sans repère prolonge la précédente).
    for (let i = 0; i < garder; i++) {
      const repere = reperes[i];
      groupeDePage.push(repere !== undefined ? groupeDeLaPlace(repere) : groupeDePage[groupeDePage.length - 1] ?? 0);
    }
    // Places par page, d'après ce que cette fenêtre vient de porter (bornées : un groupe qui finit tôt ne doit pas tout fausser).
    if (garder > 0 && suite > debut) parPage = Math.min(80, Math.max(8, (suite - debut) / garder));
    debut = suite;
    await respirer();
  }

  // Pied de page : « Page x sur N » exact, superposé page à page (N est connu maintenant).
  const pieds = await PDFDocument.load(await rendre(documentPieds(plan, groupeDePage)));
  const incorpores = await reuni.embedPdf(pieds, pieds.getPageIndices());
  reuni.getPages().forEach((page, i) => page.drawPage(incorpores[i]));

  // Sans flux d'objets : le dictionnaire des polices reste lisible en clair (contrôle des glyphes manquants).
  return Buffer.from(await reuni.save({ useObjectStreams: false }));
}

/** Rend un document de pages indépendantes par lots de `PAGES_PAR_LOT` pages, réunis dans l'ordre. */
export async function rendreParLots(plan: PlanLots, rendre: Rendu, taille: number = PAGES_PAR_LOT): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const reuni = await PDFDocument.create();
  for (let de = 0; de < plan.pages; de += taille) {
    const partie = await PDFDocument.load(await rendre(plan.lot(de, Math.min(plan.pages, de + taille))));
    for (const page of await reuni.copyPages(partie, partie.getPageIndices())) reuni.addPage(page);
    await respirer();
  }
  return Buffer.from(await reuni.save({ useObjectStreams: false }));
}
