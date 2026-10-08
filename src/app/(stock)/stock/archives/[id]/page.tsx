import Link from "next/link";
import { FilAriane } from "@/components/fil-ariane";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { qte, DOMAINE_LABEL, SEUIL_TOLERANCE_PCT } from "@/lib/stock";
import { exigerPageStock } from "@/lib/garde-page";
import { Pagination } from "@/components/pagination";
import { fenetrePage, lirePagination } from "@/lib/pagination";

export default async function ArchiveDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; par?: string }> }) {
  await exigerPageStock();
  const { id } = await params;
  const sp = await searchParams;
  const demande = lirePagination(sp);
  const session = await prisma.sessionComptage.findUnique({ where: { id } });
  if (!session) notFound();
  // Un comptage compte des centaines d'articles : les lignes sont lues par PAGE (skip/take + count) ; les
  // chiffres de l'en-tête (articles, écarts, hors tolérance) sont ceux de la fiche, donc de TOUT le comptage.
  const nbLignes = await prisma.ligneComptage.count({ where: { sessionId: id } });
  const fen = fenetrePage(nbLignes, demande.page, demande.par);
  const lignes = await prisma.ligneComptage.findMany({ where: { sessionId: id }, orderBy: [{ designation: "asc" }, { id: "asc" }], skip: fen.skip, take: fen.take });

  const horsTol = (l: (typeof lignes)[number]) =>
    Math.abs(Number(l.ecart)) > 0.0001 && (Number(l.theorique) === 0 ? Number(l.physique) !== 0 : Math.abs(Number(l.ecartPct ?? 0)) > SEUIL_TOLERANCE_PCT);

  return (
    <div className="w-full space-y-4">
      <FilAriane segments={[{ label: "Archives", href: "/stock/archives" }, { label: `Comptage du ${new Date(session.date).toLocaleDateString("fr-FR")}` }]} />
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

      <div className="tableau-normal rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="en-tete-collante bg-muted text-left">
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
            {lignes.map((l) => {
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
      <Pagination total={nbLignes} page={fen.page} par={demande.par} chemin={`/stock/archives/${id}`} params={sp} libelle="articles comptés" />
    </div>
  );
}
