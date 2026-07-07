import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { niveauAlerte, ALERTE_LABEL } from "@/lib/stock";

export async function GET() {
  const user = await verifySession();
  requireModule(user, "stock");

  const articles = await prisma.articleStock.findMany({
    orderBy: [{ domaine: "asc" }, { designation: "asc" }],
    include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true },
  });

  const lignes = articles.map((a) => {
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.seuilUrgent, a.stock.stockMinimum) : null;
    return [
      a.designation,
      a.domaine === "NOURRITURE" ? "Nourriture" : "Boisson",
      a.categorie?.nom ?? "",
      a.fournisseur?.nom ?? "",
      a.unite ?? "",
      a.prixUnitaireUSD !== null ? Number(a.prixUnitaireUSD) : "",
      a.stock ? Number(a.stock.quantite) : 0,
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.stock ? Number(a.stock.seuilUrgent) : 0,
      niv ? ALERTE_LABEL[niv] : "",
    ];
  });

  const buf = await classeurExcel({
    titre: "Catalogue — Stock & Achats",
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{
      nom: "Catalogue",
      entete: ["Désignation", "Domaine", "Catégorie", "Fournisseur", "Unité", "Prix USD", "Stock", "Minimum", "Seuil urgent", "Alerte"],
      lignes,
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Catalogue_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
