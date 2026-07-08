import { prisma } from "@/lib/prisma";
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

  const recents = await prisma.rapport.findMany({ orderBy: { createdAt: "desc" }, take: 15 });

  const lien = (type: string, format: string) => `/stock/rapports/export?type=${type}&format=${format}&debut=${debut}&fin=${fin}`;

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

      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.entries(TYPES_RAPPORT) as [string, string][]).map(([type, label]) => (
          <div key={type} className="flex items-center justify-between gap-2 rounded-lg border p-4">
            <span className="font-medium">{label}</span>
            <div className="flex shrink-0 gap-2">
              <a href={lien(type, "pdf")} download target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">PDF</a>
              <a href={lien(type, "excel")} download className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Excel</a>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Rapports générés récemment</h2>
        {recents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun rapport généré pour le moment.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold"><th>Rapport</th><th>Période</th><th>Généré le</th></tr></thead>
              <tbody>
                {recents.map((r) => (
                  <tr key={r.id} className="border-t even:bg-muted/25">
                    <td className="px-3 py-2 font-medium">{r.titre}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.periodeDebut ? new Date(r.periodeDebut).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"} → {r.periodeFin ? new Date(r.periodeFin).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(r.createdAt).toLocaleString("fr-FR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
