import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

export default async function HistoriqueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;

  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: { lignes: { include: { employee: true }, orderBy: { employee: { nom: "asc" } } } },
  });
  if (!run) notFound();

  const periode = new Date(run.annee, run.mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <Link href="/historique" className="text-sm text-primary underline">
        ← Retour à l&apos;historique
      </Link>
      <h1 className="mt-2 mb-6 text-2xl font-semibold capitalize">Paie — {periode}</h1>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Matricule</th>
              <th className="px-3 py-2">Nom et prénom</th>
              <th className="px-3 py-2">Catégorie</th>
              <th className="px-3 py-2 text-right">Salaire brut $</th>
              <th className="px-3 py-2 text-right">Salaire net $</th>
              <th className="px-3 py-2 text-right">Salaire net CDF</th>
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
                <td className="px-3 py-2 text-right">{money(Number(l.salNetUSD))}</td>
                <td className="px-3 py-2 text-right">
                  {Number(l.salNetCDF).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} CDF
                </td>
                <td className="px-3 py-2">{l.statutPaiement === "PAYE" ? "PAYÉ" : "EN ATTENTE"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <a href={`/paie/bulletin/${l.id}?devise=USD`} className="text-primary underline" target="_blank">
                    Bulletin $
                  </a>
                  {" · "}
                  <a href={`/paie/bulletin/${l.id}?devise=CDF`} className="text-primary underline" target="_blank">
                    Bulletin CDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
