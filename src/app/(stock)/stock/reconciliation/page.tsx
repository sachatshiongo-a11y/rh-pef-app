import { prisma } from "@/lib/prisma";
import { ReconciliationForm } from "./reconciliation-client";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;

  const where: Prisma.ArticleStockWhereInput = {
    actif: true,
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({ where, orderBy: { designation: "asc" }, include: { stock: true } });
  const rows = articles.map((a) => ({ id: a.id, designation: a.designation, theorique: a.stock ? Number(a.stock.quantite) : 0 }));

  const ficheHref = (dom: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("domaine", dom);
    return `/stock/reconciliation/fiche?${p}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Réconciliation d&apos;inventaire</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saisissez les quantités physiques comptées : les écarts avec le stock théorique génèrent un
            ajustement et le stock est mis au réel. Filtrez pour compter par lot.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href={ficheHref("NOURRITURE")} target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">🖨️ Fiche Nourriture</a>
          <a href={ficheHref("BOISSON")} target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">🖨️ Fiche Boissons</a>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={q} placeholder="Rechercher un article…" className="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-1.5" />
        <select name="domaine" defaultValue={domaine ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous domaines</option>
          <option value="NOURRITURE">Nourriture</option>
          <option value="BOISSON">Boisson</option>
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
      </form>

      <ReconciliationForm articles={rows} />
    </div>
  );
}
