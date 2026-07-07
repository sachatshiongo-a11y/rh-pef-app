import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_LABEL } from "@/lib/stock";
import { PrintDoc } from "../../_print/print-doc";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string };

export default async function CatalogueImprimerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;
  const where: Prisma.ArticleStockWhereInput = {
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({
    where, orderBy: [{ domaine: "asc" }, { designation: "asc" }],
    include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true },
  });

  const lignes = articles.map((a) => {
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.seuilUrgent, a.stock.stockMinimum) : null;
    return [
      a.designation,
      a.domaine === "NOURRITURE" ? "Nourriture" : "Boisson",
      a.categorie?.nom ?? "",
      a.fournisseur?.nom ?? "",
      a.prixUnitaireUSD !== null ? Number(a.prixUnitaireUSD).toFixed(2) : "",
      a.stock ? Number(a.stock.quantite) : 0,
      a.stock ? Number(a.stock.stockMinimum) : 0,
      niv ? ALERTE_LABEL[niv] : "",
    ] as (string | number)[];
  });

  return (
    <PrintDoc
      titre="Catalogue — Stock & Achats"
      sousTitre={new Date().toLocaleDateString("fr-FR")}
      entete={["Désignation", "Domaine", "Catégorie", "Fournisseur", "Prix USD", "Stock", "Min", "Alerte"]}
      aligneDroite={[4, 5, 6]}
      lignes={lignes}
    />
  );
}
