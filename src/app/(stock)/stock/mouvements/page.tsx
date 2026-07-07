import { prisma } from "@/lib/prisma";
import { qte } from "@/lib/stock";
import { SortieForm } from "./mouvements-client";

const TYPE_LABEL: Record<string, string> = { ENTREE: "Entrée", SORTIE: "Sortie", AJUSTEMENT: "Ajustement" };
const TYPE_CLASSE: Record<string, string> = {
  ENTREE: "bg-emerald-100 text-emerald-800",
  SORTIE: "bg-red-100 text-red-800",
  AJUSTEMENT: "bg-muted text-muted-foreground",
};

export default async function MouvementsPage() {
  const [mouvements, articles] = await Promise.all([
    prisma.mouvementStock.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { article: { select: { designation: true } } },
    }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Mouvements de stock</h1>
      </div>

      <SortieForm articles={articles} />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Article</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Quantité</th>
              <th className="px-3 py-2">Origine</th>
            </tr>
          </thead>
          <tbody>
            {mouvements.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-3 py-2 text-muted-foreground">{new Date(m.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-2 font-medium">{m.article.designation}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_CLASSE[m.type]}`}>{TYPE_LABEL[m.type]}</span></td>
                <td className="px-3 py-2 text-right">{m.type === "SORTIE" ? "−" : "+"}{qte(m.quantite)}</td>
                <td className="px-3 py-2 text-muted-foreground">{m.origine ?? "—"}</td>
              </tr>
            ))}
            {mouvements.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucun mouvement enregistré.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
