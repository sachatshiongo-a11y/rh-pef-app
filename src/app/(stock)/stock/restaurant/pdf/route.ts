import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { joursSemaine } from "../semaine";
import { lignesStockResto } from "../export-data";
import { articlesRestoDeLaPeriode, designationResto } from "@/lib/stock-restaurant-charger";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

/** Stock restaurant (Cuisine ou Bar) en PDF paysage : grille hebdo groupée par catégorie. */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const espace = sp.get("espace") === "BAR" ? "BAR" : "CUISINE";
  const jours = joursSemaine(sp.get("semaine") ? new Date(sp.get("semaine")!) : jourCivilKinshasa(new Date()));
  const debut = new Date(jours[0].iso), fin = new Date(jours[6].iso);

  // Semaine affichée : les actifs, et les désactivés qui y ont un comptage ou une livraison —
  // listés avec la mention « (désactivé) », jamais effacés de l'historique.
  const articles = await prisma.articleResto.findMany({
    where: { AND: [{ espace }, articlesRestoDeLaPeriode(jours[0].iso, jours[6].iso)] },
    orderBy: [{ categorie: "asc" }, { ordre: "asc" }, { designation: "asc" }],
    include: { comptages: { where: { date: { gte: debut, lte: fin } } } },
  });

  const { lignes, sectionRows } = lignesStockResto(articles.map((a) => ({ ...a, designation: designationResto(a) })), jours);
  const colonnes: Colonne[] = [
    { header: "Désignation", width: "22%" },
    { header: "Unité", width: "8%" },
    { header: "Base", width: "8%", align: "right" },
    ...jours.map((j) => ({ header: `${j.label} ${j.num}`, width: "8.85%", align: "right" as const })),
  ];

  const label = espace === "BAR" ? "Bar" : "Cuisine";
  const buffer = await renderPdfBuffer(
    TableauDocument({
      titre: `Stock restaurant — ${label}`,
      sousTitre: `Semaine du ${jours[0].num} au ${jours[6].num}`,
      colonnes,
      lignes,
      sectionRows,
      paysage: true,
      pied: "« Base » = stock de base journalier (niveau cible). Les colonnes de jours indiquent la quantité comptée.",
    }),
  );

  const fichier = `Stock_restaurant_${label}_${jours[0].iso}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fichier}"`,
    },
  });
}
