import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { MOIS_FR } from "@/lib/dates-fr";

const TYPE: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const moisStr = sp.get("mois");
  const articleId = sp.get("articleId") || undefined;
  const where: import("@prisma/client").Prisma.MouvementStockWhereInput = { ...(articleId ? { articleId } : {}) };
  let periode = "Tous les mois", suffixe = new Date().toISOString().slice(0, 10);
  if (moisStr && /^\d{4}-\d{1,2}$/.test(moisStr)) {
    const [y, m] = moisStr.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    periode = `${MOIS_FR[m - 1]} ${y}`;
    suffixe = `${y}-${String(m).padStart(2, "0")}`;
  }

  const mouvements = await prisma.mouvementStock.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 5000,
    include: { article: { select: { designation: true } } },
  });

  // Récap valorisé (les mouvements portent leur valeur USD depuis la valorisation au prix catalogue).
  let entrees = 0, sorties = 0, valEntrees = 0, valSorties = 0;
  const lignes = mouvements.map((m) => {
    const q = Number(m.quantite);
    const val = m.montantUSD !== null ? Number(m.montantUSD) : null;
    if (m.type === "SORTIE") { sorties += q; if (val) valSorties += val; }
    else { entrees += q; if (val) valEntrees += val; }
    return [
      new Date(m.date).toLocaleDateString("fr-FR"),
      m.article.designation,
      TYPE[m.type] ?? m.type,
      (m.type === "SORTIE" ? -1 : 1) * q,
      val !== null ? round2(val) : "",
      m.origine ?? "",
    ];
  });

  const resume = [
    ["Entrées (quantité)", round2(entrees), ""],
    ["Sorties (quantité)", round2(sorties), ""],
    ["Valeur des entrées (USD)", "", round2(valEntrees)],
    ["Valeur des sorties (USD)", "", round2(valSorties)],
    ["Consommation nette (USD)", "", round2(valSorties - valEntrees)],
  ];

  const buf = await classeurExcel({
    titre: "Mouvements de stock",
    periode,
    feuilles: [
      { nom: "Mouvements", entete: ["Date", "Article", "Type", "Quantité", "Valeur USD", "Origine"], lignes },
      { nom: "Récapitulatif", entete: ["Indicateur", "Quantité", "USD"], lignes: resume },
    ],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Mouvements_${suffixe}.xlsx"`,
    },
  });
}
