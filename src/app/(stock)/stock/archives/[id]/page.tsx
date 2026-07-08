import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { qte, DOMAINE_LABEL, SEUIL_TOLERANCE_PCT } from "@/lib/stock";

export default async function ArchiveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await prisma.sessionComptage.findUnique({
    where: { id },
    include: { lignes: { orderBy: { designation: "asc" } } },
  });
  if (!session) notFound();

  const horsTol = (l: (typeof session.lignes)[number]) =>
    Math.abs(Number(l.ecart)) > 0.0001 && (Number(l.theorique) === 0 ? Number(l.physique) !== 0 : Math.abs(Number(l.ecartPct ?? 0)) > SEUIL_TOLERANCE_PCT);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Comptage du {new Date(session.date).toLocaleDateString("fr-FR")}</h1>
        <Link href="/stock/archives" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">← Retour</Link>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full border px-3 py-1">Domaine : <b>{session.domaine ? DOMAINE_LABEL[session.domaine] ?? session.domaine : "Tous"}</b></span>
        <span className="rounded-full border px-3 py-1">Articles : <b>{session.nbArticles}</b></span>
        <span className="rounded-full border px-3 py-1">Écarts : <b>{session.nbEcarts}</b></span>
        <span className={`rounded-full border px-3 py-1 ${session.nbHorsTol > 0 ? "border-red-300 bg-red-50 text-red-800" : ""}`}>Hors tolérance ({SEUIL_TOLERANCE_PCT}%) : <b>{session.nbHorsTol}</b></span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <th>Article</th>
              <th className="text-right">Théorique</th>
              <th className="text-right">Physique</th>
              <th className="text-right">Écart</th>
              <th className="text-right">%</th>
              <th>Explication</th>
            </tr>
          </thead>
          <tbody>
            {session.lignes.map((l) => {
              const e = Number(l.ecart);
              const ht = horsTol(l);
              return (
                <tr key={l.id} className={`border-t ${ht ? "bg-red-50/60" : "even:bg-muted/25"}`}>
                  <td className="px-3 py-2 font-medium">{l.designation}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{qte(l.theorique)}</td>
                  <td className="px-3 py-2 text-right">{qte(l.physique)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${e === 0 ? "text-emerald-700" : ht ? "text-red-700" : "text-amber-700"}`}>{e > 0 ? "+" : ""}{qte(e)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{l.ecartPct !== null ? `${Number(l.ecartPct) > 0 ? "+" : ""}${Number(l.ecartPct).toFixed(0)}%` : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.explication ?? (ht ? "—" : "")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
