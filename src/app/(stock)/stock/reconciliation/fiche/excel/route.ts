import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { DOMAINE_LABEL } from "@/lib/stock";
import { lignesFicheComptage, ENTETE_FICHE } from "../comptage-data";
import type { Prisma } from "@prisma/client";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";

/** Fiche de comptage en Excel téléchargeable (par domaine) — génération instantanée, à imprimer/compter. */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const dom = sp.get("domaine");
  const domaine = dom === "NOURRITURE" || dom === "BOISSON" || dom === "AUTRE" ? dom : undefined;
  const q = (sp.get("q") ?? "").trim();

  const where: Prisma.ArticleStockWhereInput = {
    actif: true,
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({
    where,
    orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }],
    include: { stock: { select: { quantite: true } }, categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } } },
  });

  const { lignes, sectionRows } = lignesFicheComptage(articles, !!domaine);

  const label = domaine ? DOMAINE_LABEL[domaine] : "Inventaire";
  const buf = await classeurExcel({
    titre: `Fiche de comptage — ${label}`,
    periode: jourKinshasa(new Date()),
    feuilles: [{
      nom: label.slice(0, 30),
      entete: ENTETE_FICHE,
      lignes,
      sectionRows,
    }],
  });

  const fichier = `Fiche_comptage_${label}_${jourCourantKinshasaISO()}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fichier}"`,
    },
  });
}
