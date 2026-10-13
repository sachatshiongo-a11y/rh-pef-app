import { prisma } from "@/lib/prisma";
import { chargerHausses } from "@/lib/inventaire-export";
import { lireFiltreInventaire } from "@/lib/filtre-inventaire";
import { type ArticleRow } from "./catalogue-table";
import { CatalogueEcran } from "./catalogue-ecran";
import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/auth";
import { ciblesEnAttente } from "@/lib/validations-stock/apercu";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { lirePagination } from "@/lib/pagination";
import { CHAMPS_LIGNE_INVENTAIRE, versLigneInventaire } from "./ligne-inventaire";

type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type CatalogueSP = { q?: string; domaine?: string; alerte?: string; manque?: string; hausse?: string; page?: string; par?: string };

/** Vue catalogue unique : le domaine se choisit par pilules (?domaine=), plus d'onglets dédiés. */
export async function CatalogueView({ searchParams }: { searchParams: Promise<CatalogueSP> }) {
  const sp = await searchParams;
  const filtreInit = lireFiltreInventaire((k) => (sp as Record<string, string | undefined>)[k]); // recherche, alerte, « À compléter », hausse : l'adresse les porte, les exports les relisent
  const q = filtreInit.q;
  const { page, par } = lirePagination(sp); // page/taille de l'URL ; le filtrage se fait dans le tableau (tout est chargé : totaux sur tout le filtre)
  const alerteInit = filtreInit.alerte || undefined;
  const domFiltre: Domaine | undefined = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined;

  const where: Prisma.ArticleStockWhereInput = domFiltre ? { domaine: domFiltre } : {};
  const user = await verifySession(); // mis en cache par requête : la page l'a déjà vérifié (exigerPageStock)
  const [articles, categories, fournisseurs, haussePct, enAttente, taux] = await Promise.all([
    prisma.articleStock.findMany({ where, orderBy: [{ domaine: "asc" }, { categorie: { ordre: "asc" } }, { categorie: { nom: "asc" } }, { designation: "asc" }], select: CHAMPS_LIGNE_INVENTAIRE }), // seules les colonnes affichées (voir ligne-inventaire.ts)
    prisma.categorieStock.findMany({ orderBy: [{ ordre: "asc" }, { nom: "asc" }], select: { id: true, nom: true, domaine: true, actif: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    // Hausses du dernier prix d'achat (badge 📈) : le MÊME calcul que les exports de l'Inventaire.
    chargerHausses(domFiltre),
    ciblesEnAttente(),
    tauxDuJour(),
  ]);


  const rows: ArticleRow[] = articles.map((a) => versLigneInventaire(a, { hausses: haussePct, enAttente: enAttente.articles, taux }));

  return <CatalogueEcran rows={rows} categories={categories} fournisseurs={fournisseurs} domaine={domFiltre} q={q} alerte={alerteInit} manque={filtreInit.manque} hausse={filtreInit.hausse} pageInit={page} parInit={par} estDirection={user.role === "ADMIN"} />;
}
