import path from "node:path";
import type { ReactElement } from "react";
import { Font, renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { reponsePdfTropLong } from "./plafond";

const FAMILLE = "Optima";

let registered = false;

/**
 * Police Optima extraite depuis /System/Library/Fonts/Optima.ttc (macOS) et embarquée dans
 * assets/fonts/ pour un usage interne à l'entreprise (documents RH générés par le serveur).
 * Optima étant une police propriétaire (Apple/Linotype), ces fichiers ne doivent pas être
 * redistribués en dehors de cet usage interne.
 */
export function registerPdfFonts() {
  if (registered) return;
  registered = true;

  const dir = path.join(process.cwd(), "assets/fonts");

  Font.register({
    family: "Optima",
    fonts: [
      { src: path.join(dir, "Optima-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "Optima-Bold.ttf"), fontWeight: 700 },
      { src: path.join(dir, "Optima-Italic.ttf"), fontWeight: 400, fontStyle: "italic" },
      // Rubriques de la « Commande journalière » : gras, italique et souligné, comme le classeur.
      { src: path.join(dir, "Optima-BoldItalic.ttf"), fontWeight: 700, fontStyle: "italic" },
    ],
  });
}


/**
 * ⚠️ Contournement d'un bug de cache CROSS-DOCUMENT dans @react-pdf/font, CONSTATÉ EN PRODUCTION
 * sur ce projet (bon de commande 013/PEF/MY/JUILLET/26 du 20/07/2026 : « MY BAG DRC » rendu
 * « Y BAG DRC », « Kinshasa » → « inshasa », et même le libellé codé en dur « E-mail » du pied de
 * page → « -mail ») : le fontkit.Font d'une police PERSONNALISÉE est mis en cache process-wide au
 * premier rendu, et le subset construit par pdfkit MUTE cet objet partagé — les rendus suivants
 * du même process Node (serveur Render long-vivant) perdent des glyphes (première lettre de
 * certains textes). Même bug diagnostiqué et corrigé dans atelier-dominique-app (fonts.ts) —
 * correctif PORTÉ ici : recharger la police depuis les TTF locaux avant CHAQUE rendu, en ne
 * touchant QUE la famille Optima (jamais Font.clear(), qui casserait les polices standard).
 */
function invaliderCachePolicePourRendu(): void {
  const famille = (Font.getRegisteredFonts() as Record<string, { sources: { data: unknown; loadResultPromise: unknown }[] }>)[FAMILLE];
  if (!famille) return;
  for (const source of famille.sources) {
    source.data = null;
    source.loadResultPromise = null;
  }
}

/**
 * Point d'entrée UNIQUE pour rendre un <Document/> en Buffer PDF — remplace tout import direct de
 * `renderToBuffer` depuis "@react-pdf/renderer" dans les routes : applique systématiquement le
 * rechargement de police ci-dessus (centralisé ici pour qu'aucun futur document ne l'oublie).
 */
export function renderPdfBuffer(document: ReactElement<DocumentProps>): Promise<Buffer> {
  registerPdfFonts();
  invaliderCachePolicePourRendu();
  return renderToBuffer(document);
}

/**
 * Comme `renderPdfBuffer`, pour un document TABULAIRE dont la longueur dépend de la demande
 * (période, filtres) : la construction du document est différée dans `construire`, si bien qu'un
 * document au-delà du plafond de lignes (`verifierPlafondPdf`, lib/pdf/plafond.ts) est refusé AVANT
 * tout rendu, par une réponse 413 lisible — jamais tronqué, jamais rendu jusqu'à l'épuisement de la
 * mémoire de l'instance. Toute autre erreur remonte telle quelle.
 *
 *   const pdf = await renderPdfOuRefus(() => TableauDocument({ … }));
 *   if (pdf instanceof Response) return pdf;
 */
export async function renderPdfOuRefus(construire: () => ReactElement<DocumentProps>): Promise<Buffer | Response> {
  try {
    return await renderPdfBuffer(construire());
  } catch (e) {
    const refus = reponsePdfTropLong(e);
    if (refus) return refus;
    throw e;
  }
}
