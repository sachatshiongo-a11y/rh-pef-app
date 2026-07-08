import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";

const TYPE: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const moisStr = sp.get("mois");
  const articleId = sp.get("articleId") || undefined;
  const where: import("@prisma/client").Prisma.MouvementStockWhereInput = { ...(articleId ? { articleId } : {}) };
  if (moisStr && /^\d{4}-\d{1,2}$/.test(moisStr)) {
    const [y, m] = moisStr.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }

  const mouvements = await prisma.mouvementStock.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 5000,
    include: { article: { select: { designation: true } } },
  });

  const lignes = mouvements.map((m) => [
    new Date(m.date).toLocaleDateString("fr-FR"),
    m.article.designation,
    TYPE[m.type] ?? m.type,
    (m.type === "SORTIE" ? -1 : 1) * Number(m.quantite),
    m.origine ?? "",
  ]);

  const buf = await classeurExcel({
    titre: "Mouvements de stock",
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{ nom: "Mouvements", entete: ["Date", "Article", "Type", "Quantité", "Origine"], lignes }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Mouvements_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
