import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { usd, qte, STATUT_BC_LABEL, STATUT_BC_CLASSE } from "@/lib/stock";
import { changerStatutBonCommande } from "../actions";

export default async function BonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bc = await prisma.bonDeCommande.findUnique({
    where: { id },
    include: { lignes: true, fournisseur: true },
  });
  if (!bc) notFound();

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/stock/commandes" className="underline">Bons de commande</Link>
        <span>/</span>
        <span>{bc.numero}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{bc.numero}</h1>
          <p className="text-sm text-muted-foreground">
            {bc.fournisseur?.nom ?? "Fournisseur non renseigné"} · {new Date(bc.date).toLocaleDateString("fr-FR")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[bc.statut]}`}>{STATUT_BC_LABEL[bc.statut]}</span>
          <a href={`/stock/commandes/${bc.id}/pdf`} target="_blank" rel="noopener" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Télécharger le PDF</a>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Désignation</th>
              <th className="px-3 py-2 text-right">Quantité</th>
              <th className="px-3 py-2 text-right">Cartons</th>
              <th className="px-3 py-2 text-right">P.U. USD</th>
              <th className="px-3 py-2 text-right">Total USD</th>
            </tr>
          </thead>
          <tbody>
            {bc.lignes.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2">{l.designation}</td>
                <td className="px-3 py-2 text-right">{qte(l.quantite)}</td>
                <td className="px-3 py-2 text-right">{l.nbCartons ? qte(l.nbCartons) : "—"}</td>
                <td className="px-3 py-2 text-right">{usd(l.prixUnitaireUSD)}</td>
                <td className="px-3 py-2 text-right">{usd(l.totalLigneUSD)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-3 py-2" colSpan={4}>Total</td>
              <td className="px-3 py-2 text-right">{usd(bc.totalUSD)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4 text-sm">
        <div>
          <span className="text-muted-foreground">Délai de paiement : </span>{bc.delaiPaiement ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">Mode de paiement : </span>{bc.modePaiement ?? "—"}
        </div>
        <form action={changerStatutBonCommande.bind(null, bc.id)} className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground">Statut :</span>
          <select name="statut" defaultValue={bc.statut} className="rounded border border-input bg-background px-2 py-1 text-xs">
            {Object.entries(STATUT_BC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Mettre à jour</button>
        </form>
      </div>

      {bc.commentaire && <p className="text-sm text-muted-foreground">Note : {bc.commentaire}</p>}
    </div>
  );
}
