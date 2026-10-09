import { libellePrixComplet, prixArticleEnUSD, prixSaisi } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { niveauAlerte, ALERTE_LABEL, DOMAINE_LABEL, type NiveauAlerte } from "@/lib/stock";
import { chargerHausses, filtrerArticles } from "@/lib/inventaire-export";
import { lireFiltreInventaire } from "@/lib/filtre-inventaire";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { jourCourantKinshasaISO, jourKinshasa } from "@/lib/heure-kinshasa";
import { libelleArticle } from "@/lib/libelle-article";

// Fonds de ligne selon le niveau d'alerte (codes couleur repris à l'écran).
const ALERTE_BG: Record<NiveauAlerte, string> = { URGENT: "#fbe0e0", APPRO: "#fbf0d4", OK: "#e9f6ee" };

/** Catalogue en PDF (téléchargement direct) : groupé par catégorie, lignes colorées par alerte. */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const dom = sp.get("domaine");
  const domaine = dom === "NOURRITURE" || dom === "BOISSON" || dom === "AUTRE" ? dom : undefined;
  // Le filtre de l'écran (recherche, alerte, « À compléter », hausse) : le PDF sort EXACTEMENT l'ensemble affiché, tout — jamais la page.
  const filtre = lireFiltreInventaire((k) => sp.get(k));
  const [articlesDomaine, hausses, taux] = await Promise.all([
    prisma.articleStock.findMany({
      where: domaine ? { domaine } : {}, orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }],
      include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true },
    }),
    chargerHausses(domaine),
    tauxDuJour(),
  ]);
  const articles = filtrerArticles(articlesDomaine, hausses, filtre);

  const lignes: (string | number)[][] = [];
  const sectionRows: number[] = [];
  const alerteRow: (NiveauAlerte | null)[] = [];
  let derniereCat: string | null = null;
  for (const a of articles) {
    const catNom = a.categorie?.nom ?? "À classer";
    if (catNom !== derniereCat) { sectionRows.push(lignes.length); lignes.push([catNom]); alerteRow.push(null); derniereCat = catNom; }
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    const qte = a.stock ? Number(a.stock.quantite) : 0;
    // Prix dans SA devise de saisie (« 7 000 FC (≈ 2,50 $) ») ; valeur en dollars, « ≈ » pour un article en francs.
    const enUSD = prixArticleEnUSD(a, taux);
    const prix = enUSD ? enUSD.valeur : null;
    const prixTexte = prixSaisi(a) ? libellePrixComplet(a, taux) : null;
    const valeurTexte = prix !== null ? `${enUSD!.approx ? "≈ " : ""}${(prix * qte).toFixed(2)}` : "";
    const pct = hausses.get(a.id);
    lignes.push([
      libelleArticle(a),
      qte,
      niv ? ALERTE_LABEL[niv] : "",
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.fournisseur?.nom ?? "",
      prixTexte !== null ? `${prixTexte}${pct !== undefined ? `  ↑+${Math.round(pct)}%` : ""}` : "",
      valeurTexte,
    ]);
    alerteRow.push(niv);
  }

  const colonnes: Colonne[] = [
    { header: "Désignation", width: "26%" },
    { header: "Stock", width: "9%", align: "right" },
    { header: "Alerte", width: "13%" },
    { header: "Min", width: "7%", align: "right" },
    { header: "Fournisseur", width: "15%" },
    { header: "Prix", width: "17%", align: "right" },
    { header: "Valeur USD", width: "9%", align: "right" },
  ];

  const label = domaine ? DOMAINE_LABEL[domaine] : "Tous domaines";
  const buffer = await renderPdfBuffer(
    TableauDocument({
      titre: `Inventaire — ${label}`,
      sousTitre: jourKinshasa(new Date()),
      colonnes, lignes, sectionRows,
      couleurLigne: (r) => (alerteRow[r] ? ALERTE_BG[alerteRow[r]!] : undefined),
      pied: "Fond rouge = urgent (rupture) · orange = à réapprovisionner · vert = satisfaisant. ↑ = hausse du dernier prix d'achat. Prix dans sa devise de saisie ; l'autre devise et « ≈ » au taux du jour.",
    }),
  );

  const fichier = `Inventaire${domaine ? `_${label}` : ""}_${jourCourantKinshasaISO()}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fichier}"` },
  });
}
