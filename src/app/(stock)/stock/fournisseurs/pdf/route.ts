import { renderPdfOuRefus } from "@/lib/pdf/fonts";
import { exigerEspaceStock } from "@/lib/garde-route";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { MAX_FICHES_PDF } from "@/lib/fiche-fournisseur-export";
import { chargerFichesFournisseurs } from "@/lib/fiche-fournisseur-donnees";
import { FicheFournisseurDocument } from "@/lib/pdf/fiche-fournisseur";

/** Fiche(s) fournisseur en PDF : `?ids=a` (une fiche) ou `?ids=a,b,c` (un lot, une fiche après l'autre). */
export async function GET(request: Request) {
  const g = await exigerEspaceStock({ permission: "stock.exports" });
  if (!g.ok) return g.reponse;

  const brut = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(brut.split(",").map((x) => x.trim()).filter(Boolean))];
  if (ids.length === 0) return new Response("Aucun fournisseur choisi.", { status: 400 });
  // Refus lisible plutôt qu'un lot tronqué (le bouton se désactive aussi au-delà).
  if (ids.length > MAX_FICHES_PDF) return new Response(`Exportez ${MAX_FICHES_PDF} fiches au plus à la fois.`, { status: 400 });

  const fiches = await chargerFichesFournisseurs(ids);
  if (fiches.length === 0) return new Response("Fournisseur introuvable.", { status: 404 });

  const pdf = await renderPdfOuRefus(() => FicheFournisseurDocument({ fiches }));
  if (pdf instanceof Response) return pdf;

  const nom = fiches.length === 1 ? `Fiche_${fiches[0]!.nom.replace(/[^\w-]+/g, "_").slice(0, 40)}` : `Fiches_fournisseurs_${jourCourantKinshasaISO()}`;
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nom}.pdf"` },
  });
}
