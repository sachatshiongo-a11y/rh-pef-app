import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { TelechargerLien } from "@/components/telecharger-lien";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

export default async function HistoriquePage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string; mois?: string; statut?: string }>;
}) {
  await verifySession();
  const sp = await searchParams;
  const annee = sp.annee ? Number(sp.annee) : null;
  const mois = sp.mois ? Number(sp.mois) : null;
  const statut = sp.statut || null;
  const COULEUR_RUN: Record<string, string> = {
    VALIDE: "bg-green-100 text-green-800",
    BROUILLON: "bg-amber-100 text-amber-800",
  };

  const tous = await prisma.payrollRun.findMany({
    include: { lignes: true },
    orderBy: [{ annee: "desc" }, { mois: "desc" }],
  });

  const annees = [...new Set(tous.map((r) => r.annee))].sort((a, b) => b - a);
  const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  const runs = tous.filter(
    (r) => (!annee || r.annee === annee) && (!mois || r.mois === mois) && (!statut || r.statut === statut)
  );

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold sm:text-2xl">Historique de paie</h1>

      <form method="GET" className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border bg-card p-2.5 sm:gap-3 sm:p-3">
        <label className="flex flex-col gap-1 text-xs">
          Année
          <select name="annee" defaultValue={sp.annee ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Toutes</option>
            {annees.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Mois
          <select name="mois" defaultValue={sp.mois ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Tous</option>
            {MOIS.map((m, i) => (<option key={m} value={i + 1}>{m}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Statut
          <select name="statut" defaultValue={sp.statut ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Tous</option>
            <option value="BROUILLON">Brouillon</option>
            <option value="VALIDE">Validé</option>
          </select>
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">Filtrer</button>
        {(annee || mois || statut) && (
          <Link href="/historique" className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent">Réinitialiser</Link>
        )}
      </form>

      {/* Mobile : cartes. */}
      <div className="space-y-2 lg:hidden">
        {runs.map((r) => {
          const masseNette = r.lignes.reduce((a, l) => a + Number(l.salNetUSD), 0);
          const coutTotal = r.lignes.reduce((a, l) => a + Number(l.coutEmployeurUSD), 0);
          return (
            <div key={r.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium capitalize">{new Date(r.annee, r.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_RUN[r.statut] ?? ""}`}>{r.statut === "VALIDE" ? "Validé" : "Brouillon"}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><span className="text-muted-foreground">Employés :</span> <span className="font-medium">{r.lignes.length}</span></div>
                <div className="text-right"><span className="text-muted-foreground">Masse nette :</span> <span className="font-medium tabular-nums">{money(masseNette)} $</span></div>
                <div className="col-span-2"><span className="text-muted-foreground">Coût employeur :</span> <span className="font-medium tabular-nums">{money(coutTotal)} $</span></div>
              </div>
              <div className="mt-2 flex gap-3 text-sm">
                <Link href={`/historique/${r.id}`} className="text-primary underline">Détails</Link>
                <TelechargerLien href={`/paie/export?mois=${r.mois}&annee=${r.annee}`} className="text-primary underline">Excel</TelechargerLien>
              </div>
            </div>
          );
        })}
        {runs.length === 0 && <EtatVide message={`Aucune paie ${annee || mois ? "pour cette période" : "archivée pour le moment"}.`} />}
      </div>

      {/* Ordinateur : tableau. */}
      <div className="hidden max-h-[70vh] overflow-auto rounded-lg border lg:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Période</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2 text-right">Employés</th>
              <th className="px-3 py-2 text-right">Masse salariale nette $</th>
              <th className="px-3 py-2 text-right">Coût total employeur $</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const masseNette = r.lignes.reduce((acc, l) => acc + Number(l.salNetUSD), 0);
              const coutTotal = r.lignes.reduce((acc, l) => acc + Number(l.coutEmployeurUSD), 0);
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 capitalize">
                    {new Date(r.annee, r.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_RUN[r.statut] ?? ""}`}>
                      {r.statut === "VALIDE" ? "Validé" : "Brouillon"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.lignes.length}</td>
                  <td className="px-3 py-2 text-right">{money(masseNette)}</td>
                  <td className="px-3 py-2 text-right">{money(coutTotal)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Link href={`/historique/${r.id}`} className="text-primary underline">Détails</Link>
                    {" · "}
                    <TelechargerLien href={`/paie/export?mois=${r.mois}&annee=${r.annee}`} className="text-primary underline">Excel</TelechargerLien>
                  </td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Aucune paie {annee || mois ? "pour cette période" : "archivée pour le moment"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
