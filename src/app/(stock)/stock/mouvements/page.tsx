import { prisma } from "@/lib/prisma";
import { qte, usd } from "@/lib/stock";
import { MouvementForm, SupprimerMouvementBtn } from "./mouvements-client";
import type { Prisma } from "@prisma/client";

type Mvt = Prisma.MouvementStockGetPayload<{ include: { article: { select: { designation: true } } } }>;

function Colonne({ titre, mouvements, signe, couleur }: { titre: string; mouvements: Mvt[]; signe: string; couleur: string }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={`border-b px-3 py-2 text-sm font-semibold ${couleur}`}>{titre} <span className="font-normal opacity-70">· {mouvements.length}</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60 text-left text-xs">
            <tr className="[&>th]:px-3 [&>th]:py-1.5">
              <th>Date</th><th>Article</th><th className="text-right">Qté</th><th className="text-right">Valeur</th><th></th>
            </tr>
          </thead>
          <tbody>
            {mouvements.map((m) => (
              <tr key={m.id} className="border-t even:bg-muted/25 hover:bg-accent/40">
                <td className="px-3 py-1.5 text-muted-foreground">{new Date(m.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-1.5"><div className="font-medium">{m.article.designation}</div>{m.origine && <div className="text-[11px] text-muted-foreground">{m.origine}</div>}</td>
                <td className="px-3 py-1.5 text-right font-medium">{signe}{qte(m.quantite)}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{m.montantUSD !== null ? usd(m.montantUSD) : "—"}</td>
                <td className="px-3 py-1.5 text-right"><SupprimerMouvementBtn id={m.id} /></td>
              </tr>
            ))}
            {mouvements.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucun mouvement.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function MouvementsPage() {
  const [mouvements, articles] = await Promise.all([
    prisma.mouvementStock.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 400, include: { article: { select: { designation: true } } } }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true } }),
  ]);
  const entrees = mouvements.filter((m) => m.type !== "SORTIE");
  const sorties = mouvements.filter((m) => m.type === "SORTIE");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Mouvements de stock</h1>
        <div className="flex items-center gap-2">
          <a href="/stock/mouvements/imprimer" target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">PDF</a>
          <a href="/stock/mouvements/export" download className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Excel</a>
        </div>
      </div>

      <MouvementForm articles={articles} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Colonne titre="Entrées" mouvements={entrees} signe="+" couleur="bg-emerald-50 text-emerald-800" />
        <Colonne titre="Sorties" mouvements={sorties} signe="−" couleur="bg-red-50 text-red-800" />
      </div>
    </div>
  );
}
