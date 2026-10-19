import { Font, pdf } from "@react-pdf/renderer";
import { DocumentImprime } from "@/lib/modeles-journaliers/impression";
import { reunirPdf } from "@/lib/pdf/reunir-pdf";
import { partieImprimable, type DonneesPdfNavigateur, type PolicesOptima } from "./donnees";

// Fabrication d'un PDF DANS LE NAVIGATEUR, à partir des données d'une route (./donnees). Chargé à la
// demande (import dynamique depuis components/telecharger-lien) : react-pdf et pdf-lib ne pèsent
// jamais sur les pages. Mêmes composants que le serveur (lib/modeles-journaliers/impression) : le
// document est le même, page pour page.

const FAMILLE = "Optima";
let enregistree = false;

function enregistrerOptima(p: PolicesOptima): void {
  if (enregistree) return;
  enregistree = true;
  const url = (b64: string) => `data:font/ttf;base64,${b64}`;
  Font.register({
    family: FAMILLE,
    fonts: [
      { src: url(p.regular), fontWeight: 400 },
      { src: url(p.bold), fontWeight: 700 },
      { src: url(p.italic), fontWeight: 400, fontStyle: "italic" },
      { src: url(p.boldItalic), fontWeight: 700, fontStyle: "italic" },
    ],
  });
}

/**
 * Même contournement que le serveur (lib/pdf/fonts, invaliderCachePolicePourRendu) : le sous-ensemble
 * de police construit par un rendu MUTE l'objet partagé et le rendu suivant perd des glyphes. La
 * police est donc relue avant CHAQUE document.
 */
function invaliderCachePolice(): void {
  const famille = (Font.getRegisteredFonts() as Record<string, { sources: { data: unknown; loadResultPromise: unknown }[] }>)[FAMILLE];
  if (!famille) return;
  for (const source of famille.sources) {
    source.data = null;
    source.loadResultPromise = null;
  }
}

/** Laisse l'écran se redessiner (avancement « 3/7 ») entre deux documents. */
const respirer = () => new Promise<void>((r) => setTimeout(r, 0));

/** Rend chaque partie, l'une après l'autre, puis les réunit en un seul PDF. */
export async function fabriquerPdf(donnees: DonneesPdfNavigateur, auProgres?: (faites: number, total: number) => void): Promise<Uint8Array> {
  enregistrerOptima(donnees.polices);
  const total = donnees.parties.length;
  const octets: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    invaliderCachePolice();
    const blob = await pdf(DocumentImprime({ doc: partieImprimable(donnees, i) })).toBlob();
    octets.push(new Uint8Array(await blob.arrayBuffer()));
    auProgres?.(i + 1, total);
    await respirer();
  }
  if (octets.length === 1) return octets[0]!;
  return reunirPdf(octets, { titre: donnees.parties[0]!.titre, auteur: "Pâtes en Folie" });
}
