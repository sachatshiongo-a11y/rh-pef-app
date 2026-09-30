import { exigerEspaceStock } from "@/lib/garde-route";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { FichesTechniquesDocument } from "@/lib/pdf/fiche-technique";
import { chargerPhotosPdf } from "@/lib/fiches/photo-fiche-pdf";
import { jourKinshasa } from "@/lib/heure-kinshasa";
import { chargerFichesVues, chargerArticlesDesFiches } from "../_data/charger-fiche";
import { construireContexte } from "../_data/fiche-calc";
import { versFichePdf } from "../_data/fiche-pdf";
import { fichesAExporter } from "../_data/selection-export";

// PDF des fiches techniques, une fiche par page : les fiches de l'onglet affiché (`?vue=`), la
// sélection des actions groupées ou une seule fiche (`?ids=`) — MÊME sélection et MÊME ordre que
// l'export Excel (`fichesAExporter`). Mêmes droits que l'Excel : l'espace Stock.
//
// `?prix=avec` : la fiche chiffrée (coût, prix, marge — recalculés par le moteur à l'instant de
// l'export, jamais un chiffre stocké). Toute autre valeur, ou rien : la version SANS PRIX, à afficher
// au poste. Un lien incomplet donne donc la fiche la moins sensible, jamais l'inverse.

/** Nom de fichier ASCII lisible (« Crème brûlée » → « Creme_brulee »). */
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "fiche";

export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const avecPrix = sp.get("prix") === "avec";

  const [vues, articles] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches()]);
  const { retenues, vue } = fichesAExporter(vues, sp);
  if (retenues.length === 0) {
    return new Response("Aucune fiche technique à exporter.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const mapArticles = new Map(articles.map((a) => [a.id, a]));
  const ctx = {
    contexte: construireContexte(vues, mapArticles),
    articles: mapArticles,
    noms: new Map(vues.map((v) => [v.id, { nom: v.nom }])),
  };
  const photos = await chargerPhotosPdf(retenues);
  const fiches = retenues.map((v) => versFichePdf(v, ctx, { avecPrix, photo: photos.get(v.id) ?? null }));

  const maintenant = new Date();
  const buffer = await renderPdfBuffer(FichesTechniquesDocument({ fiches, editeLe: jourKinshasa(maintenant) }));

  const date = jourKinshasa(maintenant).split("/").reverse().join("-");
  const suffixe = avecPrix ? "" : "_sans_prix";
  const nom = retenues.length === 1
    ? `Fiche_technique_${slug(retenues[0].nom)}${suffixe}.pdf`
    : `Fiches_techniques_${vue === "boissons" ? "Boissons_" : vue === "plats" ? "Plats_" : ""}${date}${suffixe}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nom}"`,
      "Cache-Control": "no-store",
    },
  });
}
