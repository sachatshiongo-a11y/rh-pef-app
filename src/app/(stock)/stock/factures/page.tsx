import { prisma } from "@/lib/prisma";
import { usd } from "@/lib/stock";
import { FacturesUI, type FactureRow, type Groupe } from "./factures-client";
import type { Prisma } from "@prisma/client";

type SP = { statut?: string; tri?: string };
const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : null);
const MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export default async function FacturesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const f = sp.statut;
  const tri = sp.tri === "fournisseur" ? "fournisseur" : "mois";
  const where: Prisma.FactureFournisseurWhereInput =
    f === "du"
      ? { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }
      : f === "A_REGLER" || f === "REGLEE" || f === "ECHUE_NON_REGLEE"
        ? { statut: f }
        : {};

  const orderBy: Prisma.FactureFournisseurOrderByWithRelationInput[] =
    tri === "fournisseur"
      ? [{ fournisseurNom: "asc" }, { annee: "desc" }, { mois: "desc" }]
      : [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }];

  const [factures, dus, fournisseurs, bons] = await Promise.all([
    prisma.factureFournisseur.findMany({ where, orderBy, include: { fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.aggregate({ where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }, _sum: { resteAPayerUSD: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    prisma.bonDeCommande.findMany({ orderBy: [{ annee: "desc" }, { sequence: "desc" }], take: 100, select: { id: true, numero: true } }),
  ]);

  const toRow = (x: (typeof factures)[number]): FactureRow => ({
    id: x.id,
    nom: x.fournisseur?.nom ?? x.fournisseurNom,
    numero: x.numero,
    date: d(x.date),
    echeance: d(x.dateEcheance),
    montant: x.montantUSD.toString(),
    reste: Number(x.resteAPayerUSD),
    statut: x.statut,
    modePaiement: x.modePaiement ?? "",
  });

  // Groupement (l'ordre des groupes suit l'ordre des lignes déjà triées)
  const groupes: Groupe[] = [];
  const index = new Map<string, number>();
  for (const x of factures) {
    const titre = tri === "fournisseur" ? (x.fournisseur?.nom ?? x.fournisseurNom) : `${MOIS_FR[x.mois - 1]} ${x.annee}`;
    if (!index.has(titre)) { index.set(titre, groupes.length); groupes.push({ titre, factures: [] }); }
    groupes[index.get(titre)!].factures.push(toRow(x));
  }

  const onglets: { k: string; label: string }[] = [
    { k: "", label: "Toutes" },
    { k: "du", label: "À payer" },
    { k: "ECHUE_NON_REGLEE", label: "Échues" },
    { k: "REGLEE", label: "Réglées" },
  ];
  const lien = (statut: string, t: string) => {
    const p = new URLSearchParams();
    if (statut) p.set("statut", statut);
    if (t !== "mois") p.set("tri", t);
    return `/stock/factures${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Factures fournisseurs</h1>
        <span className="text-sm">Reste à payer : <span className="font-semibold text-red-700">{usd(dus._sum.resteAPayerUSD)}</span></span>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {onglets.map((o) => (
            <a key={o.k} href={lien(o.k, tri)} className={`rounded-full border px-3 py-1 ${(f ?? "") === o.k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{o.label}</a>
          ))}
        </div>
        <span className="text-muted-foreground">·</span>
        <div className="flex gap-1.5">
          <span className="text-muted-foreground">Trier par :</span>
          <a href={lien(f ?? "", "mois")} className={`rounded-full border px-3 py-1 ${tri === "mois" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Mois</a>
          <a href={lien(f ?? "", "fournisseur")} className={`rounded-full border px-3 py-1 ${tri === "fournisseur" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Fournisseur</a>
        </div>
      </div>

      <FacturesUI groupes={groupes} fournisseurs={fournisseurs} bons={bons} />
    </div>
  );
}
