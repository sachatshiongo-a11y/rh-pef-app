import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { niveauAlerte, ALERTE_LABEL, DOMAINE_LABEL } from "@/lib/stock";
import { articlesEnHausse } from "@/lib/stock-prix";

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const dom = new URL(req.url).searchParams.get("domaine");
  const domaine = dom === "NOURRITURE" || dom === "BOISSON" || dom === "AUTRE" ? dom : undefined;
  const [articles, lignesFacture] = await Promise.all([
    prisma.articleStock.findMany({
      where: domaine ? { domaine } : {},
      orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }],
      include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true },
    }),
    prisma.ligneFacture.findMany({
      where: { article: domaine ? { domaine } : {}, facture: { date: { not: null } } },
      select: { articleId: true, prixUnitaireUSD: true, quantite: true, facture: { select: { id: true, numero: true, date: true } } },
    }),
  ]);
  const hausses = articlesEnHausse(lignesFacture);

  const lignes = articles.map((a) => {
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    const qte = a.stock ? Number(a.stock.quantite) : 0;
    const prix = a.prixUnitaireUSD !== null ? Number(a.prixUnitaireUSD) : null;
    const pct = hausses.get(a.id);
    return [
      a.code ?? "",
      a.designation,
      qte,
      niv ? ALERTE_LABEL[niv] : "",
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.stock ? Number(a.stock.seuilUrgent) : 0,
      a.categorie?.nom ?? "",
      a.fournisseur?.nom ?? "",
      a.unite ?? "",
      prix ?? "",
      prix !== null ? Number((prix * qte).toFixed(2)) : "",
      a.uniteParCarton !== null ? Number(a.uniteParCarton) : "",
      pct !== undefined ? `+${Math.round(pct)}%` : "",
      DOMAINE_LABEL[a.domaine] ?? a.domaine,
    ];
  });

  const suffixe = domaine ? ` — ${DOMAINE_LABEL[domaine]}` : "";
  const suffixeFichier = domaine ? `_${DOMAINE_LABEL[domaine]}` : "";
  const buf = await classeurExcel({
    titre: `Catalogue${suffixe} — Stock & Achats`,
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{
      nom: "Catalogue",
      entete: ["Code", "Désignation", "Stock", "Alerte", "Minimum", "Seuil urgent", "Catégorie", "Fournisseur", "Unité", "Prix USD", "Valeur stock USD", "Unités/carton", "Hausse prix", "Domaine"],
      lignes,
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Catalogue${suffixeFichier}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
