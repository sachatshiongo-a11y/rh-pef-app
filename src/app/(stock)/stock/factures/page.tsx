import { prisma } from "@/lib/prisma";
import { usd, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";
import type { Prisma } from "@prisma/client";

type SP = { statut?: string };
const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");

export default async function FacturesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const f = sp.statut;
  const where: Prisma.FactureFournisseurWhereInput =
    f === "du"
      ? { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }
      : f === "A_REGLER" || f === "REGLEE" || f === "ECHUE_NON_REGLEE"
        ? { statut: f }
        : {};

  const [factures, dus] = await Promise.all([
    prisma.factureFournisseur.findMany({
      where,
      orderBy: [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }],
      include: { fournisseur: { select: { nom: true } } },
    }),
    prisma.factureFournisseur.aggregate({
      where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } },
      _sum: { resteAPayerUSD: true, montantUSD: true },
    }),
  ]);

  const onglets: { k: string; label: string }[] = [
    { k: "", label: "Toutes" },
    { k: "du", label: "À payer" },
    { k: "ECHUE_NON_REGLEE", label: "Échues" },
    { k: "REGLEE", label: "Réglées" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Factures fournisseurs</h1>
        <span className="text-sm">
          Reste à payer : <span className="font-semibold text-red-700">{usd(dus._sum.resteAPayerUSD)}</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-sm">
        {onglets.map((o) => {
          const actif = (f ?? "") === o.k;
          return (
            <a key={o.k} href={o.k ? `/stock/factures?statut=${o.k}` : "/stock/factures"} className={`rounded-full border px-3 py-1 ${actif ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>
              {o.label}
            </a>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Fournisseur</th>
              <th className="px-3 py-2">N° facture</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Échéance</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-right">Reste</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {factures.map((fac) => (
              <tr key={fac.id} className="border-t">
                <td className="px-3 py-2 font-medium">{fac.fournisseur?.nom ?? fac.fournisseurNom}</td>
                <td className="px-3 py-2 text-muted-foreground">{fac.numero ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{d(fac.date)}</td>
                <td className="px-3 py-2 text-muted-foreground">{d(fac.dateEcheance)}</td>
                <td className="px-3 py-2 text-right">{usd(fac.montantUSD)}</td>
                <td className="px-3 py-2 text-right">{Number(fac.resteAPayerUSD) > 0 ? <span className="font-medium text-red-700">{usd(fac.resteAPayerUSD)}</span> : "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[fac.statut]}`}>
                    {STATUT_FACTURE_LABEL[fac.statut]}
                  </span>
                </td>
              </tr>
            ))}
            {factures.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Aucune facture.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
