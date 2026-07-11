import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { TableauDocument } from "@/lib/pdf/tableau";
import { MOIS_FR } from "@/lib/dates-fr";

const TYPE: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };
const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `${r2(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

/** Mouvements de stock d'un mois en PDF téléchargé (fichier), avec récap valorisé. */
export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const moisStr = sp.get("mois");
  const articleId = sp.get("articleId") || undefined;
  const where: import("@prisma/client").Prisma.MouvementStockWhereInput = { ...(articleId ? { articleId } : {}) };
  let sousTitre = new Date().toLocaleDateString("fr-FR"), suffixe = new Date().toISOString().slice(0, 10);
  if (moisStr && /^\d{4}-\d{1,2}$/.test(moisStr)) {
    const [y, mm] = moisStr.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, mm - 1, 1)), lt: new Date(Date.UTC(y, mm, 1)) };
    sousTitre = `${MOIS_FR[mm - 1]} ${y}`;
    suffixe = `${y}-${String(mm).padStart(2, "0")}`;
  }

  const mouvements = await prisma.mouvementStock.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 3000,
    include: { article: { select: { designation: true } } },
  });

  const val = (m: (typeof mouvements)[number]) => (m.montantUSD !== null ? Number(m.montantUSD) : 0);
  const valEntrees = mouvements.filter((m) => m.type !== "SORTIE").reduce((t, m) => t + val(m), 0);
  const valSorties = mouvements.filter((m) => m.type === "SORTIE").reduce((t, m) => t + val(m), 0);
  const lignes = mouvements.map((m) => [
    new Date(m.date).toLocaleDateString("fr-FR"),
    m.article.designation,
    TYPE[m.type] ?? m.type,
    `${m.type === "SORTIE" ? "−" : "+"}${Number(m.quantite)}`,
    m.montantUSD !== null ? usd(Number(m.montantUSD)) : "—",
    m.origine ?? "",
  ] as (string | number)[]);

  const buf = await renderToBuffer(
    TableauDocument({
      titre: "Mouvements de stock",
      sousTitre: `${sousTitre} · ${mouvements.length} mouvement(s) · entrées ${usd(valEntrees)} · sorties ${usd(valSorties)} · conso nette ${usd(valSorties - valEntrees)}`,
      colonnes: [
        { header: "Date", width: "13%", align: "left" },
        { header: "Article", width: "37%", align: "left" },
        { header: "Type", width: "12%", align: "left" },
        { header: "Quantité", width: "12%", align: "right" },
        { header: "Valeur", width: "13%", align: "right" },
        { header: "Origine", width: "13%", align: "left" },
      ],
      lignes,
    }),
  );
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Mouvements_${suffixe}.pdf"`,
    },
  });
}
