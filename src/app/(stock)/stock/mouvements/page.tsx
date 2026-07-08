import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { qte, usd } from "@/lib/stock";
import { MouvementForm, SupprimerMouvementBtn } from "./mouvements-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";
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

const MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
type SP = { mois?: string; articleId?: string };

export default async function MouvementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const mois = sp.mois && /^\d{4}-\d{1,2}$/.test(sp.mois) ? sp.mois : undefined; // « 2026-7 »
  const articleId = sp.articleId || undefined;

  const where: Prisma.MouvementStockWhereInput = { ...(articleId ? { articleId } : {}) };
  if (mois) {
    const [y, m] = mois.split("-").map(Number);
    where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }

  const [mouvements, articles] = await Promise.all([
    prisma.mouvementStock.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 600, include: { article: { select: { designation: true } } } }),
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true } }),
  ]);
  const entrees = mouvements.filter((m) => m.type !== "SORTIE");
  const sorties = mouvements.filter((m) => m.type === "SORTIE");

  // 12 derniers mois pour le filtre.
  const now = new Date();
  const moisOptions = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return { val: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, label: `${MOIS_FR[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });
  const dlQs = new URLSearchParams({ ...(mois ? { mois } : {}), ...(articleId ? { articleId } : {}) }).toString();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Mouvements de stock</h1>
        <div className="flex items-center gap-2">
          <BoutonRapport types={[{ value: "MOUVEMENTS", label: "Mouvements" }]} />
          <a href={`/stock/mouvements/imprimer${dlQs ? `?${dlQs}` : ""}`} target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">PDF</a>
          <a href={`/stock/mouvements/export${dlQs ? `?${dlQs}` : ""}`} download className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Excel</a>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <select name="mois" defaultValue={mois ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les mois</option>
          {moisOptions.map((o) => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <select name="articleId" defaultValue={articleId ?? ""} className="min-w-56 rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les produits</option>
          {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        {(mois || articleId) && <a href="/stock/mouvements" className="text-muted-foreground underline">Réinitialiser</a>}
      </form>

      <MouvementForm articles={articles} estDirection={estDirection} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Colonne titre="Entrées" mouvements={entrees} signe="+" couleur="bg-emerald-50 text-emerald-800" />
        <Colonne titre="Sorties" mouvements={sorties} signe="−" couleur="bg-red-50 text-red-800" />
      </div>
    </div>
  );
}
