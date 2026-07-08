import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { DOMAINE_LABEL } from "@/lib/stock";
import type { Prisma } from "@prisma/client";

/** Fiche de comptage en PDF téléchargeable (par domaine), pour compter à la main. */
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
    include: { stock: true, categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } } },
  });

  const colonnes: Colonne[] = [
    { header: "Désignation", width: "28%" },
    { header: "Catégorie", width: "16%" },
    { header: "Fournisseur", width: "16%" },
    { header: "Unité", width: "8%" },
    { header: "Théorique", width: "10%", align: "right" },
    { header: "Physique", width: "11%", align: "right" },
    { header: "Écart", width: "11%", align: "right" },
  ];
  const lignes = articles.map((a) => [
    a.designation,
    a.categorie?.nom ?? "",
    a.fournisseur?.nom ?? "",
    a.unite ?? "",
    a.stock ? Number(a.stock.quantite) : 0,
    "",
    "",
  ]);

  const label = domaine ? DOMAINE_LABEL[domaine] : "Inventaire";
  const titre = `Fiche de comptage — ${label}`;
  const buffer = await renderToBuffer(
    TableauDocument({
      titre,
      sousTitre: new Date().toLocaleDateString("fr-FR"),
      colonnes,
      lignes,
      pied: "Colonnes « Physique » et « Écart » à remplir à la main lors du comptage.",
    }),
  );

  const fichier = `Fiche_comptage_${label}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fichier}"`,
    },
  });
}
