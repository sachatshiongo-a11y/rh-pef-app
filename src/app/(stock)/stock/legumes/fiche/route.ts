import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { FicheAchatLegumesDocument, ficheAchatRemplie, ficheAchatVierge } from "@/lib/pdf/fiche-achat-legumes";
import { LEGUMES } from "../legumes-data";

/**
 * Fiche « Achat de légumes Marché » en PDF.
 * - sans paramètre : fiche VIERGE (les 38 légumes, cases et totaux à remplir à la main) ;
 * - `?date=AAAA-MM-JJ` : fiche REMPLIE avec les achats de légumes enregistrés ce jour-là.
 */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const brut = (new URL(req.url).searchParams.get("date") ?? "").trim();
  const jour = new Date(`${brut}T00:00:00.000Z`);
  if (brut !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(brut) || Number.isNaN(jour.getTime()) || jour.toISOString().slice(0, 10) !== brut)) {
    return new Response("Date invalide (attendu : AAAA-MM-JJ).", { status: 400 });
  }

  let fiche = ficheAchatVierge(LEGUMES);
  let dateImprimee: string | undefined;
  if (brut !== "") {
    const [achats, config] = await Promise.all([
      prisma.achatLegume.findMany({ where: { date: jour }, orderBy: { createdAt: "asc" } }),
      prisma.config.findUnique({ where: { id: "singleton" } }),
    ]);
    fiche = ficheAchatRemplie(
      LEGUMES,
      achats.map((a) => ({
        legume: a.legume,
        unite: a.unite,
        quantite: Number(a.quantite),
        montantCDF: a.montantCDF !== null ? Number(a.montantCDF) : null,
        montantUSD: a.montantUSD !== null ? Number(a.montantUSD) : null,
      })),
      config ? Number(config.tauxChangeCDF) : 0,
    );
    const [a, m, j] = brut.split("-");
    dateImprimee = `${j}/${m}/${a}`;
  }

  const buffer = await renderPdfBuffer(FicheAchatLegumesDocument({ fiche, date: dateImprimee }));
  const fichier = `Fiche_achat_legumes_${brut || "vierge"}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fichier}"` },
  });
}
