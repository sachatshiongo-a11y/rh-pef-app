import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { joursSemaine } from "../semaine";
import { lignesStockResto } from "../export-data";

/** Stock restaurant (Cuisine ou Bar) en Excel : grille hebdo groupée par catégorie. */
export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const espace = sp.get("espace") === "BAR" ? "BAR" : "CUISINE";
  const jours = joursSemaine(sp.get("semaine") ? new Date(sp.get("semaine")!) : new Date());
  const debut = new Date(jours[0].iso), fin = new Date(jours[6].iso);

  const articles = await prisma.articleResto.findMany({
    where: { espace, actif: true },
    orderBy: [{ categorie: "asc" }, { ordre: "asc" }, { designation: "asc" }],
    include: { comptages: { where: { date: { gte: debut, lte: fin } } } },
  });

  const { lignes, sectionRows } = lignesStockResto(articles, jours);
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
