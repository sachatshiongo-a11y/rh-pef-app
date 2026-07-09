import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { ReconciliationForm } from "./reconciliation-client";
import { BoutonSupprimerTout } from "../_rapport/bouton-supprimer-tout";
import { supprimerTousComptages } from "./actions";
import type { Prisma } from "@prisma/client";

type SP = { q?: string; domaine?: string };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const q = (sp.q ?? "").trim();
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" || sp.domaine === "AUTRE" ? sp.domaine : undefined;

  const where: Prisma.ArticleStockWhereInput = {
    actif: true,
    ...(domaine ? { domaine } : {}),
    ...(q ? { designation: { contains: q, mode: "insensitive" } } : {}),
  };
  const articles = await prisma.articleStock.findMany({ where, orderBy: { designation: "asc" }, include: { stock: true } });
  const rows = articles.map((a) => ({ id: a.id, designation: a.designation, theorique: a.stock ? Number(a.stock.quantite) : 0 }));

  // Comptages déjà appliqués (aussi archivés dans Archives) — consultables ici.
  const comptages = await prisma.sessionComptage.findMany({ orderBy: { createdAt: "desc" }, take: 12 });

  const ficheHref = (dom: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("domaine", dom);
    return `/stock/reconciliation/fiche/pdf?${p}`; // téléchargement PDF direct (comme les PDF RH)
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
          <a href={ficheHref("NOURRITURE")} download target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Fiche Nourriture</a>
          <a href={ficheHref("BOISSON")} download target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Fiche Boissons</a>
          <a href={ficheHref("AUTRE")} download target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Fiche Autre</a>
          <BoutonSupprimerTout estDirection={estDirection} action={supprimerTousComptages} libelle="Supprimer TOUS les comptages archivés ?" />
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <input name="q" defaultValue={q} placeholder="Rechercher un article…" className="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-1.5" />
        <select name="domaine" defaultValue={domaine ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous domaines</option>
          <option value="NOURRITURE">Nourriture</option>
          <option value="BOISSON">Boisson</option>
          <option value="AUTRE">Autre</option>
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
      </form>

      <ReconciliationForm articles={rows} domaine={domaine} estDirection={estDirection} />

      {comptages.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Comptages récents</h2>
          <div className="space-y-2">
            {comptages.map((s) => (
              <Link key={s.id} href={`/stock/archives/${s.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 hover:bg-accent/40">
                <div>
                  <div className="font-medium">{new Date(s.date).toLocaleDateString("fr-FR")}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.nbArticles} articles · {s.nbEcarts} écart(s)
                    {s.nbHorsTol > 0 && <> · <span className="font-semibold text-red-700">{s.nbHorsTol} hors tolérance</span></>}
                  </div>
                </div>
                <span className="shrink-0 text-sm text-primary underline">Ouvrir</span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Tous les comptages sont aussi conservés dans <Link href="/stock/archives?vue=comptages" className="underline">Archives</Link>.</p>
        </div>
      )}
    </div>
  );
}
