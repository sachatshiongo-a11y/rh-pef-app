import Link from "next/link";
import { TYPES_RAPPORT } from "@/lib/rapports";

type SP = { debut?: string; fin?: string };
const moisISO = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export default async function RapportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = new Date();
  const finDef = moisISO(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const debutDef = moisISO(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)));
  const debut = sp.debut && /^\d{4}-\d{2}$/.test(sp.debut) ? sp.debut : debutDef;
  const fin = sp.fin && /^\d{4}-\d{2}$/.test(sp.fin) ? sp.fin : finDef;

  const lien = (type: string, format: string, mode: string) => `/stock/rapports/export?type=${type}&format=${format}&mode=${mode}&debut=${debut}&fin=${fin}`;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Rapports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Générez des rapports mensuels (PDF ou Excel) pour suivre les tendances — hausse ou baisse — sur la période choisie.</p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-lg border p-3 text-sm">
        <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Du (mois)</span><input type="month" name="debut" defaultValue={debut} className="rounded-md border border-input bg-background px-2 py-1.5" /></label>
        <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Au (mois)</span><input type="month" name="fin" defaultValue={fin} className="rounded-md border border-input bg-background px-2 py-1.5" /></label>
        <button className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Appliquer la période</button>
      </form>

      <p className="text-sm text-muted-foreground"><b>Chiffré</b> = totaux mensuels + tendances. <b>Détaillé</b> = liste ligne par ligne (fournisseurs, articles, montants).</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.entries(TYPES_RAPPORT) as [string, string][]).map(([type, label]) => (
          <div key={type} className="space-y-2 rounded-lg border p-4">
            <p className="font-medium">{label}</p>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Chiffré :</span>
                <a href={lien(type, "pdf", "chiffre")} download target="_blank" rel="noopener" className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">PDF</a>
                <a href={lien(type, "excel", "chiffre")} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Excel</a>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Détaillé :</span>
                <a href={lien(type, "pdf", "detail")} download target="_blank" rel="noopener" className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">PDF</a>
                <a href={lien(type, "excel", "detail")} download className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Excel</a>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">L’historique des rapports générés est disponible dans l’onglet <Link href="/stock/archives?vue=rapports" className="text-primary underline">Archives</Link>.</p>
    </div>
  );
}
