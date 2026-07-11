import { prisma } from "@/lib/prisma";
import { PrintDoc } from "../../_print/print-doc";
import { MOIS_FR } from "@/lib/dates-fr";

const TYPE: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };
const usd = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

export default async function MouvementsImprimerPage({ searchParams }: { searchParams: Promise<{ mois?: string; articleId?: string }> }) {
  const sp = await searchParams;
  const where: import("@prisma/client").Prisma.MouvementStockWhereInput = { ...(sp.articleId ? { articleId: sp.articleId } : {}) };
  let sousTitre = new Date().toLocaleDateString("fr-FR");
  if (sp.mois && /^\d{4}-\d{1,2}$/.test(sp.mois)) {
    const [y, m] = sp.mois.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    sousTitre = `${MOIS_FR[m - 1]} ${y}`;
  }
  const mouvements = await prisma.mouvementStock.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 2000,
    include: { article: { select: { designation: true } } },
  });

  let valEntrees = 0, valSorties = 0;
  const lignes = mouvements.map((m) => {
    const val = m.montantUSD !== null ? Number(m.montantUSD) : null;
    if (val !== null) { if (m.type === "SORTIE") valSorties += val; else valEntrees += val; }
    return [
      new Date(m.date).toLocaleDateString("fr-FR"),
      m.article.designation,
      TYPE[m.type] ?? m.type,
      `${m.type === "SORTIE" ? "−" : "+"}${Number(m.quantite)}`,
      val !== null ? usd(val) : "—",
      m.origine ?? "",
    ] as (string | number)[];
  });

  return (
    <PrintDoc
      titre="Mouvements de stock"
      sousTitre={`${sousTitre} · ${mouvements.length} mouvement(s) · entrées ${usd(valEntrees)} · sorties ${usd(valSorties)} · conso nette ${usd(valSorties - valEntrees)}`}
      entete={["Date", "Article", "Type", "Quantité", "Valeur", "Origine"]}
      aligneDroite={[3, 4]}
      lignes={lignes}
    />
  );
}
