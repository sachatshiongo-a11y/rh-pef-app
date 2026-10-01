import { prisma } from "@/lib/prisma";
import { niveauAlerte, type NiveauAlerte } from "@/lib/stock";
import { articlesEnHausse } from "@/lib/stock-prix";
import { type ArticleRow } from "./catalogue-table";
import { CatalogueEcran } from "./catalogue-ecran";
import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/auth";

type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type CatalogueSP = { q?: string; domaine?: string; alerte?: string };

/** Vue catalogue unique : le domaine se choisit par pilules (?domaine=), plus d'onglets dédiés. */
export async function CatalogueView({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const alerteInit = sp.alerte === "URGENT" || sp.alerte === "APPRO" || sp.alerte === "OK" ? sp.alerte : undefined;
  const domFiltre: Domaine | undefined = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined;

  const where: Prisma.ArticleStockWhereInput = domFiltre ? { domaine: domFiltre } : {};
  const user = await verifySession(); // mis en cache par requête : la page l'a déjà vérifié (exigerPageStock)
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
      nomCourt: a.nomCourt,
      surFicheCommande: a.surFicheCommande,
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

  return <CatalogueEcran rows={rows} categories={categories} fournisseurs={fournisseurs} domaine={domFiltre} q={q} alerte={alerteInit} estDirection={user.role === "ADMIN"} />;
}
