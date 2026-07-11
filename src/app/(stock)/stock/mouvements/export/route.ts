import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel, type FeuilleExcel } from "@/lib/export-excel";
import { MOIS_FR } from "@/lib/dates-fr";
import { DOMAINES, DOMAINE_LABEL } from "@/lib/cloture-inventaire";

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
    include: { article: { select: { designation: true, domaine: true } } },
  });

  const ligne = (m: (typeof mouvements)[number]) => {
    const val = m.montantUSD !== null ? round2(Number(m.montantUSD)) : "";
    return [
      new Date(m.date).toLocaleDateString("fr-FR"),
      m.article.designation,
      TYPE[m.type] ?? m.type,
      (m.type === "SORTIE" ? -1 : 1) * Number(m.quantite),
      val,
      m.origine ?? "",
    ] as (string | number)[];
  };
  const entete = ["Date", "Article", "Type", "Quantité", "Valeur USD", "Origine"];

  // Un onglet par domaine (Nourriture / Boissons / Autre) — ventilation demandée.
  const feuilles: FeuilleExcel[] = DOMAINES.map((dom) => ({
    nom: DOMAINE_LABEL[dom],
    entete,
    lignes: mouvements.filter((m) => String(m.article.domaine) === dom).map(ligne),
  }));

  // Récap valorisé global (les mouvements portent leur valeur USD depuis la valorisation au prix catalogue).
  const som = (pred: (m: (typeof mouvements)[number]) => boolean, val: boolean) =>
    round2(mouvements.filter(pred).reduce((t, m) => t + (val ? (m.montantUSD !== null ? Number(m.montantUSD) : 0) : Number(m.quantite)), 0));
  const estSortie = (m: (typeof mouvements)[number]) => m.type === "SORTIE";
  const estEntree = (m: (typeof mouvements)[number]) => m.type !== "SORTIE";
  feuilles.push({
    nom: "Récapitulatif",
    entete: ["Indicateur", "Quantité", "USD"],
    lignes: [
      ["Entrées (quantité)", som(estEntree, false), ""],
      ["Sorties (quantité)", som(estSortie, false), ""],
      ["Valeur des entrées (USD)", "", som(estEntree, true)],
      ["Valeur des sorties (USD)", "", som(estSortie, true)],
      ["Consommation nette (USD)", "", round2(som(estSortie, true) - som(estEntree, true))],
    ],
  });

  const buf = await classeurExcel({ titre: "Mouvements de stock", periode, feuilles });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Mouvements_${suffixe}.xlsx"`,
    },
  });
}
