import { exigerEspaceStock } from "@/lib/garde-route";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { FicheComptageDocument, rangeesFicheComptage } from "@/lib/pdf/fiche-comptage";
import { DOMAINE_LABEL } from "@/lib/stock";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";
import { lignesFicheComptage } from "../comptage-data";
import { chargerArticlesFiche, domaineDeFiche } from "../charger-articles";

/**
 * Fiche de comptage VIERGE en PDF (par domaine), à imprimer et remplir à la main : le pendant de `../excel`, avec les
 * mêmes articles (`chargerArticlesFiche`), les mêmes colonnes et le même regroupement. Mêmes droits que la fiche Excel.
 */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const domaine = domaineDeFiche(new URL(req.url).searchParams.get("domaine"));
  const articles = await chargerArticlesFiche(domaine);
  const { lignes, sectionRows } = lignesFicheComptage(articles, !!domaine);

  const label = domaine ? DOMAINE_LABEL[domaine] : "Inventaire";
  const buffer = await renderPdfBuffer(
    FicheComptageDocument({
      titre: `Fiche de comptage — ${label}`,
      sousTitre: jourKinshasa(new Date()),
      rangees: rangeesFicheComptage(lignes, sectionRows),
    }),
  );

  const fichier = `Fiche_comptage_${label}_${jourCourantKinshasaISO()}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fichier}"` },
  });
}
