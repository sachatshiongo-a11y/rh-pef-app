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
import { moisEnCours } from "@/lib/mouvements-article-mois";
import { chargerDonneesStockInitial } from "@/lib/stock-initial-mois-donnees";
import { quantiteInitiale, stockInitialArticle } from "@/lib/stock-initial-mois";

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
  const { annee, mois } = moisEnCours();
  const [articlesDomaine, hausses, taux, debutMois] = await Promise.all([
    prisma.articleStock.findMany({
      where: domaine ? { domaine } : {},
      orderBy: [{ domaine: "asc" }, { categorie: { ordre: "asc" } }, { categorie: { nom: "asc" } }, { designation: "asc" }],
      include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true, _count: { select: { fournisseurs: true } } }, // fournisseur = l'HABITUEL ; le compte sert au filtre « sans fournisseur »
    }),
    chargerHausses(domaine),
    tauxDuJour(),
    chargerDonneesStockInitial(annee, mois).catch((e): null => { console.error("[stock] export de l'Inventaire : stock début de mois indisponible :", e); return null; }), // agrégats, pas une requête par article ; en panne : « — » (l'export reste utile)
  ]);
  const articles = filtrerArticles(articlesDomaine, hausses, filtre);

  const alerteRow: (NiveauAlerte | null)[] = [];
  const lignes = articles.map((a) => {
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum, a.stock.seuilUrgent) : null;
    alerteRow.push(niv);
    const qte = a.stock ? Number(a.stock.quantite) : 0;
    // Prix en $ ET en FC : celui de la devise de saisie est exact, l'autre au taux du jour (colonne « Devise du prix »).
    const enUSD = prixArticleEnUSD(a, taux);
    const enCDF = prixArticleEnCDF(a, taux);
    const prix = enUSD ? Math.round(enUSD.valeur * 10000) / 10000 : null;
    const saisi = prixSaisi(a);
    const pct = hausses.get(a.id);
    // « — » (texte) quand le stock au 1er est inconnu ou que l'article n'existait pas encore : jamais 0.
    const debut = debutMois === null ? null : quantiteInitiale(stockInitialArticle(debutMois, a.id, a.stock ? a.stock.quantite.toString() : null).initial);
    return [
      a.code ?? "",
      libelleArticle(a),
      debut ?? "—",
      qte,
      a.unite ?? "",
      niv ? ALERTE_LABEL[niv] : "",
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.stock ? Number(a.stock.seuilUrgent) : 0,
      a.categorie?.nom ?? "",
      a.fournisseur?.nom ?? "",
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
      entete: ["Code", "Désignation", "Stock début de mois", "Stock", "Unité", "Alerte", "Minimum", "Seuil urgent", "Catégorie", "Fournisseur", "Prix USD", "Valeur stock USD", "Unités/carton", "Hausse prix", "Domaine", "Prix FC", "Devise du prix"],
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
