import { prisma } from "@/lib/prisma";
import { niveauAlerte, type NiveauAlerte } from "@/lib/stock";
import { chargerHausses } from "@/lib/inventaire-export";
import { lireFiltreInventaire } from "@/lib/filtre-inventaire";
import { type ArticleRow } from "./catalogue-table";
import { CatalogueEcran } from "./catalogue-ecran";
import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/auth";
import { ciblesEnAttente } from "@/lib/validations-stock/apercu";
import { libellesPrix, prixArticleEnUSD, valeurEnUSD } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { lirePagination } from "@/lib/pagination";
import { contenancePourClient } from "@/lib/libelle-article";

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
    prisma.articleStock.findMany({ where, orderBy: [{ domaine: "asc" }, { categorie: { ordre: "asc" } }, { categorie: { nom: "asc" } }, { designation: "asc" }], include: { stock: true } }),
    prisma.categorieStock.findMany({ orderBy: [{ ordre: "asc" }, { nom: "asc" }], select: { id: true, nom: true, domaine: true, actif: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    // Hausses du dernier prix d'achat (badge 📈) : le MÊME calcul que les exports de l'Inventaire.
    chargerHausses(domFiltre),
    ciblesEnAttente(),
    tauxDuJour(),
  ]);


  const rows: ArticleRow[] = articles.map((a) => {
    const niveau: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    return {
      id: a.id,
      code: a.code,
      designation: a.designation,
      ...contenancePourClient(a), // libellé affiché (désignation + contenance) : `libelleArticle`, côté écran
      nomCourt: a.nomCourt,
      surFicheCommande: a.surFicheCommande,
      domaine: a.domaine,
      categorieId: a.categorieId,
      fournisseurId: a.fournisseurId,
      unite: a.unite,
      prix: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
      // Prix en francs (2026-10-08) : la devise de saisie fait foi, l'autre « ≈ » au taux du jour.
      devisePrix: a.devisePrix,
      prixCDF: a.prixUnitaireCDF !== null ? a.prixUnitaireCDF.toString() : null,
      prixAutre: libellesPrix(a, taux).autre,
      prixEnUSD: prixArticleEnUSD(a, taux)?.valeur ?? null, // tri de la colonne Prix
      ...(() => { const v = valeurEnUSD(a, a.stock ? Number(a.stock.quantite) : 0, taux); return { valeurUSD: v ? v.valeur : null, valeurApprox: v?.approx ?? false }; })(),
      uniteParCarton: a.uniteParCarton !== null ? a.uniteParCarton.toString() : null,
      quantite: a.stock ? a.stock.quantite.toString() : "0",
      stockMinimum: a.stock ? a.stock.stockMinimum.toString() : "0",
      niveau,
      haussePct: haussePct.get(a.id) ?? null,
      propositionEnAttente: enAttente.articles.has(a.id),
    };
  });

  return <CatalogueEcran rows={rows} categories={categories} fournisseurs={fournisseurs} domaine={domFiltre} q={q} alerte={alerteInit} manque={filtreInit.manque} hausse={filtreInit.hausse} pageInit={page} parInit={par} estDirection={user.role === "ADMIN"} />;
}
