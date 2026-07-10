import { prisma } from "@/lib/prisma";
import { niveauAlerte, usd, type NiveauAlerte } from "@/lib/stock";
import { CatalogueTable, type ArticleRow } from "./catalogue-table";
import type { Prisma } from "@prisma/client";

type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type CatalogueSP = { q?: string; domaine?: string; alerte?: string };

const TITRE: Record<Domaine, string> = { NOURRITURE: "Catalogue — Nourriture", BOISSON: "Catalogue — Boissons", AUTRE: "Catalogue — Autre" };

/** Vue catalogue partagée. `domaine` fixe le domaine (onglet dédié) ; sinon vue « tous domaines ». */
export async function CatalogueView({ domaine, searchParams }: { domaine?: Domaine; searchParams: Promise<CatalogueSP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domFiltre: Domaine | undefined = domaine ?? (sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined);

  const where: Prisma.ArticleStockWhereInput = domFiltre ? { domaine: domFiltre } : {};
  const [articles, categories, fournisseurs] = await Promise.all([
    prisma.articleStock.findMany({ where, orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }], include: { stock: true } }),
    prisma.categorieStock.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true, domaine: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);

  const rows: ArticleRow[] = articles.map((a) => {
    const niveau: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    return {
      id: a.id,
      designation: a.designation,
      domaine: a.domaine,
      categorieId: a.categorieId,
      fournisseurId: a.fournisseurId,
      unite: a.unite,
      prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
      uniteParCarton: a.uniteParCarton !== null ? a.uniteParCarton.toString() : null,
      quantite: a.stock ? a.stock.quantite.toString() : "0",
      stockMinimum: a.stock ? a.stock.stockMinimum.toString() : "0",
      niveau,
    };
  });

  const dlParams = new URLSearchParams({ ...(q ? { q } : {}), ...(domFiltre ? { domaine: domFiltre } : {}) });
  const qs = dlParams.toString() ? `?${dlParams}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">{domaine ? TITRE[domaine] : "Catalogue"}</h1>
        <div className="flex items-center gap-2">
          <span className="rounded-md border bg-muted/40 px-2.5 py-1 text-sm"><span className="text-muted-foreground">Valeur du stock&nbsp;: </span><span className="font-semibold tabular-nums">{usd(rows.reduce((t, r) => t + (Number(r.prix) || 0) * (Number(r.quantite) || 0), 0))}</span></span>
          <span className="mr-1 text-sm text-muted-foreground">{rows.length} article(s)</span>
          <a href={`/stock/catalogue/imprimer${qs}`} target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">PDF</a>
          <a href={`/stock/catalogue/export${qs}`} download className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Excel</a>
        </div>
      </div>

      <CatalogueTable articles={rows} categories={categories} fournisseurs={fournisseurs} lockedDomaine={domaine} initialQ={q} />
    </div>
  );
}
