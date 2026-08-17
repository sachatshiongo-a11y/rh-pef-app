import { prisma } from "@/lib/prisma";
import { niveauAlerte, usd, type NiveauAlerte } from "@/lib/stock";
import { articlesEnHausse } from "@/lib/stock-prix";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { CatalogueTable, type ArticleRow } from "./catalogue-table";
import type { Prisma } from "@prisma/client";

type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type CatalogueSP = { q?: string; domaine?: string; alerte?: string };

const DOMAINES: { cle: Domaine | ""; label: string }[] = [
  { cle: "", label: "Tous" },
  { cle: "NOURRITURE", label: "Nourriture" },
  { cle: "BOISSON", label: "Boissons" },
  { cle: "AUTRE", label: "Autre" },
];

/** Vue catalogue unique : le domaine se choisit par pilules (?domaine=), plus d'onglets dédiés. */
export async function CatalogueView({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const alerteInit = sp.alerte === "URGENT" || sp.alerte === "APPRO" || sp.alerte === "OK" ? sp.alerte : undefined;
  const domFiltre: Domaine | undefined = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined;

  // Bascule de domaine en conservant recherche et filtre d'alerte.
  const lienDomaine = (cle: Domaine | "") => {
    const p = new URLSearchParams({ ...(q ? { q } : {}), ...(alerteInit ? { alerte: alerteInit } : {}), ...(cle ? { domaine: cle } : {}) });
    return `/stock/catalogue${p.toString() ? `?${p}` : ""}`;
  };

  const where: Prisma.ArticleStockWhereInput = domFiltre ? { domaine: domFiltre } : {};
  const [articles, categories, fournisseurs, lignes, entreesPayees] = await Promise.all([
    prisma.articleStock.findMany({ where, orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }], include: { stock: true } }),
    prisma.categorieStock.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true, domaine: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    // Historique de prix (lignes de facture datées) pour détecter les hausses, en une requête.
    prisma.ligneFacture.findMany({
      where: { article: domFiltre ? { domaine: domFiltre } : {}, facture: { date: { not: null } } },
      select: { articleId: true, prixUnitaireUSD: true, quantite: true, facture: { select: { id: true, numero: true, date: true } } },
    }),
    // Entrées PAYÉES hors facture (liste d'achat, mouvement manuel avec montant) : des achats
    // quand même — leur prix unitaire compte dans l'évolution du prix d'achat.
    prisma.mouvementStock.findMany({
      where: { type: "ENTREE", factureId: null, montantUSD: { not: null }, ...(domFiltre ? { article: { domaine: domFiltre } } : {}) },
      select: { articleId: true, montantUSD: true, quantite: true, date: true, origine: true },
    }),
  ]);

  // Pour chaque article, un éventuel % de hausse du dernier achat (badge dans le catalogue).
  const haussePct = articlesEnHausse(lignes, entreesPayees);

  const rows: ArticleRow[] = articles.map((a) => {
    const niveau: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    return {
      id: a.id,
      code: a.code,
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
      haussePct: haussePct.get(a.id) ?? null,
    };
  });

  const dlParams = new URLSearchParams({ ...(q ? { q } : {}), ...(domFiltre ? { domaine: domFiltre } : {}) });
  const qs = dlParams.toString() ? `?${dlParams}` : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold sm:text-2xl">Catalogue</h1>
          <div className="flex overflow-hidden rounded-md border text-sm">
            {DOMAINES.map((d) =>
              (domFiltre ?? "") === d.cle ? (
                <span key={d.label} className="bg-primary px-3 py-1.5 font-medium text-primary-foreground">{d.label}</span>
              ) : (
                <a key={d.label} href={lienDomaine(d.cle)} className="px-3 py-1.5 hover:bg-accent">{d.label}</a>
              )
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border bg-muted/40 px-2.5 py-1 text-sm"><span className="text-muted-foreground">Valeur du stock&nbsp;: </span><span className="font-semibold tabular-nums">{usd(rows.reduce((t, r) => t + (Number(r.prix) || 0) * (Number(r.quantite) || 0), 0))}</span></span>
          <span className="mr-1 text-sm text-muted-foreground">{rows.length} article(s)</span>
          <BoutonRapport pdfHref={`/stock/catalogue/pdf${qs}`} pdfDownload excelHref={`/stock/catalogue/export${qs}`} />
        </div>
      </div>

      <CatalogueTable articles={rows} categories={categories} fournisseurs={fournisseurs} lockedDomaine={domFiltre} initialQ={q} initialAlerte={alerteInit} />
    </div>
  );
}
