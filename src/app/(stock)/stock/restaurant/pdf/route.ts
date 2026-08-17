import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { joursSemaine } from "../semaine";
import { lignesStockResto } from "../export-data";

/** Stock restaurant (Cuisine ou Bar) en PDF paysage : grille hebdo groupée par catégorie. */
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
