import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { niveauAlerte, ALERTE_LABEL, DOMAINE_LABEL, type NiveauAlerte } from "@/lib/stock";
import { articlesEnHausse } from "@/lib/stock-prix";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import type { Prisma } from "@prisma/client";

// Fonds de ligne selon le niveau d'alerte (codes couleur repris à l'écran).
const ALERTE_BG: Record<NiveauAlerte, string> = { URGENT: "#fbe0e0", APPRO: "#fbf0d4", OK: "#e9f6ee" };

/** Catalogue en PDF (téléchargement direct) : groupé par catégorie, lignes colorées par alerte. */
export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const dom = sp.get("domaine");
  const domaine = dom === "NOURRITURE" || dom === "BOISSON" || dom === "AUTRE" ? dom : undefined;
  const q = (sp.get("q") ?? "").trim();

  const where: Prisma.ArticleStockWhereInput = {
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const [articles, lignesFacture] = await Promise.all([
    prisma.articleStock.findMany({
      where, orderBy: [{ domaine: "asc" }, { categorie: { nom: "asc" } }, { designation: "asc" }],
      include: { categorie: { select: { nom: true } }, fournisseur: { select: { nom: true } }, stock: true },
    }),
    prisma.ligneFacture.findMany({
      where: { article: domaine ? { domaine } : {}, facture: { date: { not: null } } },
      select: { articleId: true, prixUnitaireUSD: true, quantite: true, facture: { select: { id: true, numero: true, date: true } } },
    }),
  ]);
  const hausses = articlesEnHausse(lignesFacture);

  const lignes: (string | number)[][] = [];
  const sectionRows: number[] = [];
  const alerteRow: (NiveauAlerte | null)[] = [];
  let derniereCat: string | null = null;
  for (const a of articles) {
    const catNom = a.categorie?.nom ?? "À classer";
    if (catNom !== derniereCat) { sectionRows.push(lignes.length); lignes.push([catNom]); alerteRow.push(null); derniereCat = catNom; }
    const niv = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
    const qte = a.stock ? Number(a.stock.quantite) : 0;
    const prix = a.prixUnitaireUSD !== null ? Number(a.prixUnitaireUSD) : null;
    const pct = hausses.get(a.id);
    lignes.push([
      a.designation,
      qte,
      niv ? ALERTE_LABEL[niv] : "",
      a.stock ? Number(a.stock.stockMinimum) : 0,
      a.fournisseur?.nom ?? "",
      prix !== null ? `${prix.toFixed(2)}${pct !== undefined ? `  ↑+${Math.round(pct)}%` : ""}` : "",
      prix !== null ? (prix * qte).toFixed(2) : "",
    ]);
    alerteRow.push(niv);
  }

  const colonnes: Colonne[] = [
    { header: "Désignation", width: "30%" },
    { header: "Stock", width: "9%", align: "right" },
    { header: "Alerte", width: "16%" },
    { header: "Min", width: "8%", align: "right" },
    { header: "Fournisseur", width: "18%" },
    { header: "Prix USD", width: "10%", align: "right" },
    { header: "Valeur USD", width: "9%", align: "right" },
  ];

  const label = domaine ? DOMAINE_LABEL[domaine] : "Tous domaines";
  const buffer = await renderPdfBuffer(
    TableauDocument({
      titre: `Catalogue — ${label}`,
      sousTitre: new Date().toLocaleDateString("fr-FR"),
      colonnes, lignes, sectionRows,
      couleurLigne: (r) => (alerteRow[r] ? ALERTE_BG[alerteRow[r]!] : undefined),
      pied: "Fond rouge = urgent (rupture) · orange = à réapprovisionner · vert = satisfaisant. ↑ = hausse du dernier prix d'achat.",
    }),
  );

  const fichier = `Catalogue${domaine ? `_${label}` : ""}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fichier}"` },
  });
}
