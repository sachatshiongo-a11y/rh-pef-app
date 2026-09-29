import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { joursSemaine } from "../semaine";
import { lignesStockResto } from "../export-data";
import { articlesRestoDeLaPeriode, designationResto } from "@/lib/stock-restaurant-charger";

/** Stock restaurant (Cuisine ou Bar) en Excel : grille hebdo groupée par catégorie. */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const espace = sp.get("espace") === "BAR" ? "BAR" : "CUISINE";
  const jours = joursSemaine(sp.get("semaine") ? new Date(sp.get("semaine")!) : new Date());
  const debut = new Date(jours[0].iso), fin = new Date(jours[6].iso);

  // Semaine affichée : les actifs, et les désactivés qui y ont un comptage ou une livraison —
  // listés avec la mention « (désactivé) », jamais effacés de l'historique.
  const articles = await prisma.articleResto.findMany({
    where: { AND: [{ espace }, articlesRestoDeLaPeriode(jours[0].iso, jours[6].iso)] },
    orderBy: [{ categorie: "asc" }, { ordre: "asc" }, { designation: "asc" }],
    include: { comptages: { where: { date: { gte: debut, lte: fin } } } },
  });

  const { lignes, sectionRows } = lignesStockResto(articles.map((a) => ({ ...a, designation: designationResto(a) })), jours);
  const label = espace === "BAR" ? "Bar" : "Cuisine";
  const buf = await classeurExcel({
    titre: `Stock restaurant — ${label}`,
    periode: `Semaine du ${jours[0].num} au ${jours[6].num}`,
    feuilles: [{
      nom: label,
      entete: ["Désignation", "Unité", "Stock base", ...jours.map((j) => `${j.label} ${j.num}`)],
      lignes,
      sectionRows,
    }],
  });

  const fichier = `Stock_restaurant_${label}_${jours[0].iso}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fichier}"`,
    },
  });
}
