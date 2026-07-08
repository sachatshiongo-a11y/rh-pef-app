import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DOMAINE_LABEL } from "@/lib/stock";

export default async function ArchivesPage() {
  const sessions = await prisma.sessionComptage.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Archives des comptages</h1>
        <p className="mt-1 text-sm text-muted-foreground">Chaque comptage appliqué est archivé ici. Cliquez pour revoir la fiche (théorique, physique, écarts, explications).</p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <th>Date</th>
              <th>Domaine</th>
              <th className="text-right">Articles</th>
              <th className="text-right">Écarts</th>
              <th className="text-right">Hors tolérance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t even:bg-muted/25 hover:bg-accent/40">
                <td className="px-3 py-2 font-medium">{new Date(s.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.domaine ? DOMAINE_LABEL[s.domaine] ?? s.domaine : "Tous"}</td>
                <td className="px-3 py-2 text-right">{s.nbArticles}</td>
                <td className="px-3 py-2 text-right">{s.nbEcarts}</td>
                <td className="px-3 py-2 text-right">{s.nbHorsTol > 0 ? <span className="font-semibold text-red-700">{s.nbHorsTol}</span> : "0"}</td>
                <td className="px-3 py-2 text-right"><Link href={`/stock/archives/${s.id}`} className="text-primary underline">Ouvrir</Link></td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun comptage archivé.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
