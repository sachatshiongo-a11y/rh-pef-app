import { libellePrixComplet, prixArticleEnUSD, prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_LABEL } from "@/lib/stock";
import { chargerHausses, filtrerArticles } from "@/lib/inventaire-export";
import { lireFiltreInventaire } from "@/lib/filtre-inventaire";
import { PrintDoc } from "../../_print/print-doc";
import { exigerPageStock } from "@/lib/garde-page";
import { jourKinshasa } from "@/lib/heure-kinshasa";
import { libelleArticle } from "@/lib/libelle-article";

type SP = { q?: string; domaine?: string; alerte?: string; manque?: string; hausse?: string };

export default async function CatalogueImprimerPage({ searchParams }: { searchParams: Promise<SP> }) {
  await exigerPageStock();
  const sp = await searchParams;
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined;
  // Le filtre de l'écran : la page imprimable sort EXACTEMENT l'ensemble affiché, tout — jamais la page.
  const filtre = lireFiltreInventaire((k) => (sp as Record<string, string | undefined>)[k]);
  const [articlesDomaine, hausses, taux] = await Promise.all([
    prisma.articleStock.findMany({
      where: domaine ? { domaine } : {}, orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }],
      include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true },
    }),
    chargerHausses(domaine),
    tauxDuJour(),
  ]);
  const articles = filtrerArticles(articlesDomaine, hausses, filtre);

  const lignes = articles.map((a) => {
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    const qte = a.stock ? Number(a.stock.quantite) : 0;
    // Prix dans SA devise de saisie (« 7 000 FC (≈ 2,50 $) ») ; valeur en dollars, « ≈ » pour un article en francs.
    const enUSD = prixArticleEnUSD(a, taux);
    const prix = enUSD ? enUSD.valeur : null;
    const prixTexte = prixSaisi(a) ? libellePrixComplet(a, taux) : null;
    const valeurTexte = prix !== null ? `${enUSD!.approx ? "≈ " : ""}${(prix * qte).toFixed(2)}` : "";
    const pct = hausses.get(a.id);
    // La hausse est signalée directement dans la colonne Prix (ex. « 3.50  ↑+75% »).
    const prixCell = prixTexte !== null ? `${prixTexte}${pct !== undefined ? `  ↑+${Math.round(pct)}%` : ""}` : (pct !== undefined ? `↑+${Math.round(pct)}%` : "");
    return [
      libelleArticle(a),
      qte,
      niv ? ALERTE_LABEL[niv] : "",
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.categorie?.nom ?? "",
      a.fournisseur?.nom ?? "",
      prixCell,
      valeurTexte,
    ] as (string | number)[];
  });

  return (
    <PrintDoc
      titre="Inventaire — Stock & Achats"
      sousTitre={jourKinshasa(new Date())}
      entete={["Désignation", "Stock", "Alerte", "Min", "Catégorie", "Fournisseur", "Prix", "Valeur USD"]}
      aligneDroite={[1, 3, 6, 7]}
      lignes={lignes}
    />
  );
}
