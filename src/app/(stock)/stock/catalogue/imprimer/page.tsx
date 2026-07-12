import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_LABEL } from "@/lib/stock";
import { articlesEnHausse } from "@/lib/stock-prix";
import { PrintDoc } from "../../_print/print-doc";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string };

export default async function CatalogueImprimerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined;
  const where: Prisma.ArticleStockWhereInput = {
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const [articles, lignesFacture] = await Promise.all([
    prisma.articleStock.findMany({
      where, orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }],
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
    // La hausse est signalée directement dans la colonne Prix (ex. « 3.50  ↑+75% »).
    const prixCell = prix !== null ? `${prix.toFixed(2)}${pct !== undefined ? `  ↑+${Math.round(pct)}%` : ""}` : (pct !== undefined ? `↑+${Math.round(pct)}%` : "");
    return [
      a.designation,
      qte,
      niv ? ALERTE_LABEL[niv] : "",
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.categorie?.nom ?? "",
      a.fournisseur?.nom ?? "",
      prixCell,
      prix !== null ? (prix * qte).toFixed(2) : "",
    ] as (string | number)[];
  });

  return (
    <PrintDoc
      titre="Catalogue — Stock & Achats"
      sousTitre={new Date().toLocaleDateString("fr-FR")}
      entete={["Désignation", "Stock", "Alerte", "Min", "Catégorie", "Fournisseur", "Prix USD", "Valeur USD"]}
      aligneDroite={[1, 3, 6, 7]}
      lignes={lignes}
    />
  );
}
