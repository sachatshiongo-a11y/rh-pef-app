import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { usd, STATUT_BC_LABEL, STATUT_BC_CLASSE } from "@/lib/stock";

export default async function CommandesPage() {
  const commandes = await prisma.bonDeCommande.findMany({
    orderBy: [{ annee: "desc" }, { sequence: "desc" }],
    include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Bons de commande</h1>
        <Link href="/stock/commandes/nouveau" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
          + Nouveau bon de commande
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Numéro</th>
              <th className="px-3 py-2">Fournisseur</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2 text-right">Lignes</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {commandes.map((c) => (
              <tr key={c.id} className="border-t hover:bg-accent/40 even:bg-muted/25">
                <td className="px-3 py-2 font-medium">{c.numero}</td>
                <td className="px-3 py-2">{c.fournisseur?.nom ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{new Date(c.date).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-2 text-right">{c._count.lignes}</td>
                <td className="px-3 py-2 text-right">{usd(c.totalUSD)}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[c.statut]}`}>{STATUT_BC_LABEL[c.statut]}</span></td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/stock/commandes/${c.id}`} className="text-primary underline">Ouvrir</Link>
                    {c.statut !== "BROUILLON" && c.statut !== "ANNULE" && (
                      <a href={`/stock/commandes/${c.id}/pdf`} download className="text-primary underline">PDF</a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {commandes.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Aucun bon de commande.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
