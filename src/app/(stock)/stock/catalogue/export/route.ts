import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { niveauAlerte, ALERTE_LABEL, DOMAINE_LABEL, type NiveauAlerte } from "@/lib/stock";
import { chargerHausses, filtrerArticles } from "@/lib/inventaire-export";
import { lireFiltreInventaire } from "@/lib/filtre-inventaire";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";
import { prixArticleEnCDF, prixArticleEnUSD, prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { libelleArticle } from "@/lib/libelle-article";

// Codes couleur d'alerte (ARGB) pour le fond des lignes Excel.
const ALERTE_ARGB: Record<NiveauAlerte, string> = { URGENT: "FFFBE0E0", APPRO: "FFFBF0D4", OK: "FFE9F6EE" };

export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const dom = sp.get("domaine");
  const domaine = dom === "NOURRITURE" || dom === "BOISSON" || dom === "AUTRE" ? dom : undefined;
  // Le filtre de l'écran (recherche, alerte, « À compléter », hausse) : l'export sort EXACTEMENT l'ensemble affiché, tout — jamais la page.
  const filtre = lireFiltreInventaire((k) => sp.get(k));
  const [articlesDomaine, hausses, taux] = await Promise.all([
    prisma.articleStock.findMany({
      where: domaine ? { domaine } : {},
      orderBy: [{ domaine: "asc" }, { categorie: { ordre: "asc" } }, { categorie: { nom: "asc" } }, { designation: "asc" }],
      include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true },
    }),
    chargerHausses(domaine),
    tauxDuJour(),
  ]);
  const articles = filtrerArticles(articlesDomaine, hausses, filtre);

  const alerteRow: (NiveauAlerte | null)[] = [];
  const lignes = articles.map((a) => {
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    alerteRow.push(niv);
    const qte = a.stock ? Number(a.stock.quantite) : 0;
    // Prix en $ ET en FC : celui de la devise de saisie est exact, l'autre au taux du jour (colonne « Devise du prix »).
    const enUSD = prixArticleEnUSD(a, taux);
    const enCDF = prixArticleEnCDF(a, taux);
    const prix = enUSD ? Math.round(enUSD.valeur * 10000) / 10000 : null;
    const saisi = prixSaisi(a);
    const pct = hausses.get(a.id);
    return [
      a.code ?? "",
      libelleArticle(a),
      qte,
      niv ? ALERTE_LABEL[niv] : "",
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.stock ? Number(a.stock.seuilUrgent) : 0,
      a.categorie?.nom ?? "",
      a.fournisseur?.nom ?? "",
      a.unite ?? "",
      prix ?? "",
      prix !== null ? Number((prix * qte).toFixed(2)) : "",
      a.uniteParCarton !== null ? Number(a.uniteParCarton) : "",
      pct !== undefined ? `+${Math.round(pct)}%` : "",
      DOMAINE_LABEL[a.domaine] ?? a.domaine,
      enCDF ? Math.round(enCDF.valeur) : "",
      saisi ? (saisi.devise === "CDF" ? "FC (le $ est au taux du jour)" : "USD") : "",
    ];
  });

  const suffixe = domaine ? ` — ${DOMAINE_LABEL[domaine]}` : "";
  const suffixeFichier = domaine ? `_${DOMAINE_LABEL[domaine]}` : "";
  const buf = await classeurExcel({
    titre: `Inventaire${suffixe} — Stock & Achats`,
    periode: jourKinshasa(new Date()),
    feuilles: [{
      nom: "Inventaire",
      entete: ["Code", "Désignation", "Stock", "Alerte", "Minimum", "Seuil urgent", "Catégorie", "Fournisseur", "Unité", "Prix USD", "Valeur stock USD", "Unités/carton", "Hausse prix", "Domaine", "Prix FC", "Devise du prix"],
      lignes,
      couleurLigne: (r) => (alerteRow[r] ? ALERTE_ARGB[alerteRow[r]!] : undefined),
    }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Inventaire${suffixeFichier}_${jourCourantKinshasaISO()}.xlsx"`,
    },
  });
}
