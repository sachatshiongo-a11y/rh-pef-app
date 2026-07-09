import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { DOMAINE_LABEL } from "@/lib/stock";
import type { Prisma } from "@prisma/client";

/** Fiche de comptage en Excel téléchargeable (par domaine) — génération instantanée, à imprimer/compter. */
export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

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
    orderBy: [{ domaine: "asc" }, { categorieId: "asc" }, { designation: "asc" }],
    include: { stock: { select: { quantite: true } }, categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } } },
  });

  const lignes = articles.map((a) => [
    a.designation,
    a.categorie?.nom ?? "",
    a.fournisseur?.nom ?? "",
    a.unite ?? "",
    a.stock ? Number(a.stock.quantite) : 0,
    "", // Physique — à remplir à la main
    "", // Écart — à remplir à la main
  ]);

  const label = domaine ? DOMAINE_LABEL[domaine] : "Inventaire";
  const buf = await classeurExcel({
    titre: `Fiche de comptage — ${label}`,
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{
      nom: label.slice(0, 30),
      entete: ["Désignation", "Catégorie", "Fournisseur", "Unité", "Théorique", "Physique", "Écart"],
      lignes,
    }],
  });

  const fichier = `Fiche_comptage_${label}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fichier}"`,
    },
  });
}
