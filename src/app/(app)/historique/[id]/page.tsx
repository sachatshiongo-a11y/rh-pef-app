import Link from "next/link";
import { TelechargerLien } from "@/components/telecharger-lien";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "@/lib/paie-net";
import { exigerPageRH } from "@/lib/garde-page";

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

export default async function HistoriqueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigerPageRH();
  const { id } = await params;

  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: { lignes: { include: { employee: true }, orderBy: { employee: { nom: "asc" } } } },
  });
  if (!run) notFound();
  // Lignes hors calcul (ligne rouverte d'un salarié sorti du calcul) : hors des totaux (paie-hors-calcul.ts).
  run.lignes = await lignesComptees(prisma, run.lignes);

  const periode = new Date(run.annee, run.mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <Link href="/paie?vue=historique" className="text-sm text-primary underline">
        ← Retour à l&apos;historique
      </Link>
      <h1 className="mt-2 mb-4 text-xl font-semibold sm:text-2xl capitalize">Paie — {periode}</h1>

      {/* Les documents du mois : mêmes routes et mêmes gardes que sur l'écran Paie, pour CE mois
          (`?mois=&annee=`) — un mois clôturé garde sa liasse, son ZIP et son livre de paie. */}
      <div className="mb-6 flex flex-wrap gap-2">
        {([
          ["Bulletins en un PDF ($)", `/paie/bulletins-pdf?mois=${run.mois}&annee=${run.annee}&devise=USD`],
          ["Bulletins en un PDF (CDF)", `/paie/bulletins-pdf?mois=${run.mois}&annee=${run.annee}&devise=CDF`],
          ["Bulletins en ZIP ($)", `/paie/bulletins-zip?mois=${run.mois}&annee=${run.annee}&devise=USD`],
          ["Bulletins en ZIP (CDF)", `/paie/bulletins-zip?mois=${run.mois}&annee=${run.annee}&devise=CDF`],
          ["Livre de paie (PDF)", `/paie/export-pdf?mois=${run.mois}&annee=${run.annee}`],
          ["Livre de paie (Excel)", `/paie/export?mois=${run.mois}&annee=${run.annee}`],
        ] as const).map(([libelle, href]) => (
          <TelechargerLien key={href} href={href} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            {libelle}
          </TelechargerLien>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Matricule</th>
              <th className="px-3 py-2">Nom et prénom</th>
              <th className="px-3 py-2">Catégorie</th>
              <th className="px-3 py-2 text-right">Salaire brut $</th>
              <th className="px-3 py-2 text-right">Salaire net $</th>
              <th className="px-3 py-2 text-right">Salaire net CDF</th>
              <th className="px-3 py-2 text-right">Total versé $</th>
              <th className="px-3 py-2">Paiement</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {run.lignes.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{l.employee.matricule}</td>
                <td className="px-3 py-2">
                  <Link href={`/employes/${l.employee.id}`} className="text-primary underline">
                    {l.employee.nom}
                  </Link>
                </td>
                <td className="px-3 py-2">{l.employee.categorie}</td>
                <td className="px-3 py-2 text-right">{money(Number(l.salBrutUSD))}</td>
                <td className="px-3 py-2 text-right">{money(salaireNetUSD(l))}</td>
                <td className="px-3 py-2 text-right">
                  {salaireNetCDF(l, Number(run.tauxChangeUtilise)).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} CDF
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">{money(totalVerseUSD(l))}</td>
                <td className="px-3 py-2">{l.statutPaiement === "PAYE" ? "PAYÉ" : "EN ATTENTE"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=USD&dl=1`} className="text-primary underline">
                    Bulletin $
                  </TelechargerLien>
                  {" · "}
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=CDF&dl=1`} className="text-primary underline">
                    Bulletin CDF
                  </TelechargerLien>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
