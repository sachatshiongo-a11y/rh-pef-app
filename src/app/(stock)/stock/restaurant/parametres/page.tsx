import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ParametresResto, type ArtParam } from "./parametres-client";

export default async function ParametresRestoPage({ searchParams }: { searchParams: Promise<{ espace?: string }> }) {
  const sp = await searchParams;
  const espace = sp.espace === "BAR" ? "BAR" : "CUISINE";

  const articles = await prisma.articleResto.findMany({ where: { espace }, orderBy: [{ ordre: "asc" }, { designation: "asc" }] });
  const rows: ArtParam[] = articles.map((a) => ({
    id: a.id,
    categorie: a.categorie ?? "",
    designation: a.designation,
    unite: a.unite ?? "",
    base: a.stockBaseJournalier !== null ? Number(a.stockBaseJournalier).toString() : "",
    ordre: a.ordre,
  }));
  const categories = [...new Set(articles.map((a) => a.categorie).filter((c): c is string => !!c))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Paramètres — Stock restaurant</h1>
          <p className="mt-1 text-sm text-muted-foreground">Gérez la liste des produits (Cuisine / Bar), leur catégorie, unité, stock de base et ordre d’affichage.</p>
        </div>
        <Link href={`/stock/restaurant?espace=${espace}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">← Retour à la grille</Link>
      </div>

      <div className="flex gap-1.5 text-sm">
        <a href="/stock/restaurant/parametres?espace=CUISINE" className={`rounded-full border px-3 py-1 ${espace === "CUISINE" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Cuisine</a>
        <a href="/stock/restaurant/parametres?espace=BAR" className={`rounded-full border px-3 py-1 ${espace === "BAR" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Bar</a>
      </div>

      <ParametresResto espace={espace} articles={rows} categories={categories} />
    </div>
  );
}
