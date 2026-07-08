import { prisma } from "@/lib/prisma";
import { PrintDoc } from "../../_print/print-doc";

const TYPE: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };

export default async function MouvementsImprimerPage({ searchParams }: { searchParams: Promise<{ mois?: string; articleId?: string }> }) {
  const sp = await searchParams;
  const where: import("@prisma/client").Prisma.MouvementStockWhereInput = { ...(sp.articleId ? { articleId: sp.articleId } : {}) };
  if (sp.mois && /^\d{4}-\d{1,2}$/.test(sp.mois)) {
    const [y, m] = sp.mois.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }
  const mouvements = await prisma.mouvementStock.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 2000,
    include: { article: { select: { designation: true } } },
  });

  const lignes = mouvements.map((m) => [
    new Date(m.date).toLocaleDateString("fr-FR"),
    m.article.designation,
    TYPE[m.type] ?? m.type,
    `${m.type === "SORTIE" ? "−" : "+"}${Number(m.quantite)}`,
    m.origine ?? "",
  ] as (string | number)[]);

  return (
    <PrintDoc
      titre="Mouvements de stock"
      sousTitre={new Date().toLocaleDateString("fr-FR")}
      entete={["Date", "Article", "Type", "Quantité", "Origine"]}
      aligneDroite={[3]}
      lignes={lignes}
    />
  );
}
