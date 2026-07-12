import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { qte } from "@/lib/stock";
import { lundiDe } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";

type SP = { semaine?: string; domaine?: string };
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

export default async function JournalierPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;
  const lundi = sp.semaine ? lundiDe(new Date(sp.semaine)) : lundiDe(new Date());
  const jours = Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
  const finSemaine = addDays(lundi, 7);

  const where: Prisma.MouvementStockWhereInput = {
    type: "SORTIE",
    date: { gte: lundi, lt: finSemaine },
    ...(domaine ? { article: { domaine } } : {}),
  };
  const sorties = await prisma.mouvementStock.findMany({
    where,
    include: { article: { select: { designation: true, domaine: true } } },
  });

  // Agrégation article × jour
  const parArticle = new Map<string, { articleId: string; designation: string; jours: number[]; total: number }>();
  for (const m of sorties) {
    const key = m.articleId;
    if (!parArticle.has(key)) parArticle.set(key, { articleId: key, designation: m.article.designation, jours: Array(7).fill(0), total: 0 });
    const idx = Math.floor((new Date(m.date).getTime() - lundi.getTime()) / 86_400_000);
    const q = Number(m.quantite);
    const row = parArticle.get(key)!;
    if (idx >= 0 && idx < 7) row.jours[idx] += q;
    row.total += q;
  }
  const rows = [...parArticle.values()].sort((a, b) => a.designation.localeCompare(b.designation));
  const totauxJour = jours.map((_, i) => rows.reduce((t, r) => t + r.jours[i], 0));

  const lienSemaine = (d: Date) => {
    const p = new URLSearchParams();
    p.set("semaine", iso(d));
    if (domaine) p.set("domaine", domaine);
    return `/stock/journalier?${p}`;
  };
  const lienDom = (dom: string) => {
    const p = new URLSearchParams();
    p.set("semaine", iso(lundi));
    if (dom) p.set("domaine", dom);
    return `/stock/journalier?${p}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Consommation journalière</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sorties de stock par jour (cuisine / bar). Enregistrez les sorties datées depuis l&apos;onglet Mouvements.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1">
          <Link href={lienSemaine(addDays(lundi, -7))} className="rounded-md border px-2 py-1 hover:bg-accent">←</Link>
          <span className="px-2 font-medium">Semaine du {lundi.getUTCDate()}/{lundi.getUTCMonth() + 1} au {addDays(lundi, 6).getUTCDate()}/{addDays(lundi, 6).getUTCMonth() + 1}</span>
          <Link href={lienSemaine(addDays(lundi, 7))} className="rounded-md border px-2 py-1 hover:bg-accent">→</Link>
          <Link href={lienSemaine(new Date())} className="ml-1 rounded-md border px-2 py-1 hover:bg-accent">Cette semaine</Link>
        </div>
        <span className="text-muted-foreground">·</span>
        <div className="flex gap-1.5">
          {[["", "Tous"], ["NOURRITURE", "Cuisine (nourriture)"], ["BOISSON", "Bar (boissons)"]].map(([k, label]) => (
            <a key={k} href={lienDom(k)} className={`rounded-full border px-3 py-1 ${(domaine ?? "") === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</a>
          ))}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <th>Article</th>
              {jours.map((d, i) => <th key={i} className="!text-right">{JOURS[i]} {d.getUTCDate()}</th>)}
              <th className="!text-right">Total</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
            {rows.map((r, ri) => (
              <tr key={ri} className="hover:bg-accent/40 even:bg-muted/25">
                <td className="font-medium"><Link href={`/stock/catalogue/${r.articleId}`} className="text-primary hover:underline">{r.designation}</Link></td>
                {r.jours.map((q, i) => <td key={i} className="text-right text-muted-foreground">{q > 0 ? qte(q) : ""}</td>)}
                <td className="text-right font-semibold">{qte(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Aucune sortie enregistrée cette semaine.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-muted/50 font-semibold [&>td]:px-3 [&>td]:py-2">
                <td>Total jour</td>
                {totauxJour.map((t, i) => <td key={i} className="text-right">{t > 0 ? qte(t) : ""}</td>)}
                <td className="text-right">{qte(totauxJour.reduce((a, b) => a + b, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
