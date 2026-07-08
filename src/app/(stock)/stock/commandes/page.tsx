import Link from "next/link";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { prisma } from "@/lib/prisma";
import { usd, STATUT_BC_LABEL, STATUT_BC_CLASSE } from "@/lib/stock";
import type { Prisma } from "@prisma/client";

type SP = { mois?: string; fournisseurId?: string };
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export default async function CommandesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const mois = sp.mois && /^\d{1,2}$/.test(sp.mois) ? Number(sp.mois) : undefined;
  const fournisseurId = sp.fournisseurId || undefined;

  const where: Prisma.BonDeCommandeWhereInput = {
    ...(mois ? { mois } : {}),
    ...(fournisseurId ? { fournisseurId } : {}),
  };
  const [commandes, fournisseurs] = await Promise.all([
    prisma.bonDeCommande.findMany({ where, orderBy: [{ annee: "desc" }, { sequence: "desc" }], include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } } } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Bons de commande</h1>
        <div className="flex items-center gap-2">
          <BoutonRapport types={[{ value: "BONS_COMMANDE", label: "Bons de commande" }]} />
          <Link href="/stock/commandes/nouveau" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">+ Nouveau bon de commande</Link>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <select name="mois" defaultValue={mois ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les mois</option>
          {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select name="fournisseurId" defaultValue={fournisseurId ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les fournisseurs</option>
          {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        <Link href="/stock/commandes" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Réinitialiser</Link>
      </form>

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
            {commandes.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Aucun bon de commande pour ce filtre.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
