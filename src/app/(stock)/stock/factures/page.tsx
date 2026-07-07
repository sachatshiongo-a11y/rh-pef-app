import { prisma } from "@/lib/prisma";
import { usd } from "@/lib/stock";
import { FacturesUI, type FactureRow } from "./factures-client";
import type { Prisma } from "@prisma/client";

type SP = { statut?: string };
const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : null);

export default async function FacturesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const f = sp.statut;
  const where: Prisma.FactureFournisseurWhereInput =
    f === "du"
      ? { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }
      : f === "A_REGLER" || f === "REGLEE" || f === "ECHUE_NON_REGLEE"
        ? { statut: f }
        : {};

  const [factures, dus, fournisseurs, bons] = await Promise.all([
    prisma.factureFournisseur.findMany({ where, orderBy: [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }], include: { fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.aggregate({ where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }, _sum: { resteAPayerUSD: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    prisma.bonDeCommande.findMany({ orderBy: [{ annee: "desc" }, { sequence: "desc" }], take: 100, select: { id: true, numero: true } }),
  ]);

  const rows: FactureRow[] = factures.map((x) => ({
    id: x.id,
    nom: x.fournisseur?.nom ?? x.fournisseurNom,
    numero: x.numero,
    date: d(x.date),
    echeance: d(x.dateEcheance),
    montant: x.montantUSD.toString(),
    reste: Number(x.resteAPayerUSD),
    statut: x.statut,
  }));

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
        <span className="text-sm">Reste à payer : <span className="font-semibold text-red-700">{usd(dus._sum.resteAPayerUSD)}</span></span>
      </div>

      <div className="flex flex-wrap gap-1.5 text-sm">
        {onglets.map((o) => {
          const actif = (f ?? "") === o.k;
          return (
            <a key={o.k} href={o.k ? `/stock/factures?statut=${o.k}` : "/stock/factures"} className={`rounded-full border px-3 py-1 ${actif ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{o.label}</a>
          );
        })}
      </div>

      <FacturesUI factures={rows} fournisseurs={fournisseurs} bons={bons} />
    </div>
  );
}
