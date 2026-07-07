import { prisma } from "@/lib/prisma";
import { niveauAlerte, type NiveauAlerte } from "@/lib/stock";
import { CatalogueTable, type ArticleRow } from "./catalogue-table";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string; alerte?: string };

export default async function CataloguePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;
  const alerte = sp.alerte === "URGENT" || sp.alerte === "APPRO" || sp.alerte === "OK" ? sp.alerte : undefined;

  const where: Prisma.ArticleStockWhereInput = {
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const [articles, categories, fournisseurs] = await Promise.all([
    prisma.articleStock.findMany({ where, orderBy: { designation: "asc" }, include: { stock: true } }),
    prisma.categorieStock.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true, domaine: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);

  const rows: ArticleRow[] = articles
    .map((a) => {
      const niveau: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.seuilUrgent, a.stock.stockMinimum) : null;
      return {
        id: a.id,
        designation: a.designation,
        domaine: a.domaine,
        categorieId: a.categorieId,
        fournisseurId: a.fournisseurId,
        prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
        quantite: a.stock ? a.stock.quantite.toString() : "0",
        stockMinimum: a.stock ? a.stock.stockMinimum.toString() : "0",
        seuilUrgent: a.stock ? a.stock.seuilUrgent.toString() : "0",
        niveau,
      };
    })
    .filter((r) => (alerte ? r.niveau === alerte : true));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Catalogue</h1>
        <span className="text-sm text-muted-foreground">{rows.length} article(s)</span>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={q} placeholder="Rechercher un article…" className="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-1.5" />
        <select name="domaine" defaultValue={domaine ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous domaines</option>
          <option value="NOURRITURE">Nourriture</option>
          <option value="BOISSON">Boisson</option>
        </select>
        <select name="alerte" defaultValue={alerte ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Toutes alertes</option>
          <option value="URGENT">Urgent</option>
          <option value="APPRO">À réapprovisionner</option>
          <option value="OK">Satisfaisant</option>
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
      </form>

      <CatalogueTable articles={rows} categories={categories} fournisseurs={fournisseurs} />
    </div>
  );
}
