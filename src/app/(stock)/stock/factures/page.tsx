import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { usd } from "@/lib/stock";
import { FacturesUI, type FactureRow, type Groupe, type AnneeGroupe } from "./factures-client";
import { ImportFacturesBtn } from "./import-factures-btn";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import type { Prisma } from "@prisma/client";

type SP = { statut?: string; tri?: string; vue?: string };
const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : null);
const MOIS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const JOUR_MS = 86400000;
/** Jours restants avant l'échéance (négatif si dépassée) ; null si réglée ou sans échéance. */
function joursAvant(echeance: Date | null, statut: string): number | null {
  if (statut === "REGLEE" || !echeance) return null;
  const e = new Date(echeance), auj = new Date();
  const e0 = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const a0 = Date.UTC(auj.getUTCFullYear(), auj.getUTCMonth(), auj.getUTCDate());
  return Math.round((e0 - a0) / JOUR_MS);
}

export default async function FacturesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const f = sp.statut;
  const tri = sp.tri === "fournisseur" ? "fournisseur" : "mois";
  const vue = sp.vue === "fournisseur" ? "fournisseur" : "detail";
  const where: Prisma.FactureFournisseurWhereInput =
    f === "du" ? { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }
      : f === "A_REGLER" || f === "REGLEE" || f === "ECHUE_NON_REGLEE" ? { statut: f } : {};
  const orderBy: Prisma.FactureFournisseurOrderByWithRelationInput[] =
    tri === "fournisseur" ? [{ fournisseurNom: "asc" }, { annee: "desc" }, { mois: "desc" }] : [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }];

  const [factures, toutes, config] = await Promise.all([
    prisma.factureFournisseur.findMany({ where, orderBy, include: { fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.findMany({ select: { fournisseurId: true, fournisseurNom: true, montantUSD: true, resteAPayerUSD: true, statut: true, annee: true, mois: true, fournisseur: { select: { nom: true } } } }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);

  // KPIs globaux
  const kpi = { total: 0, regle: 0, du: 0, echu: 0 };
  for (const x of toutes) {
    const m = Number(x.montantUSD), r = Number(x.resteAPayerUSD);
    kpi.total += m; kpi.regle += m - r;
    if (x.statut !== "REGLEE") kpi.du += r;
    if (x.statut === "ECHUE_NON_REGLEE") kpi.echu += r;
  }
  // Solde par fournisseur
  const anneeC = config?.anneeCourante ?? new Date().getFullYear();
  const moisC = config?.moisCourant ?? new Date().getMonth() + 1;
  const map = new Map<string, { id: string | null; nom: string; solde: number; total: number; nb: number; nbAnnee: number; nbMois: number }>();
  for (const x of toutes) {
    const nom = x.fournisseur?.nom ?? x.fournisseurNom;
    const e = map.get(nom) ?? { id: null, nom, solde: 0, total: 0, nb: 0, nbAnnee: 0, nbMois: 0 };
    if (!e.id && x.fournisseurId) e.id = x.fournisseurId;
    e.solde += x.statut !== "REGLEE" ? Number(x.resteAPayerUSD) : 0;
    e.total += Number(x.montantUSD); e.nb++;
    if (x.annee === anneeC) { e.nbAnnee++; if (x.mois === moisC) e.nbMois++; }
    map.set(nom, e);
  }
  const parFournisseur = [...map.values()].sort((a, b) => b.solde - a.solde || b.total - a.total);

  const toRow = (x: (typeof factures)[number]): FactureRow => ({
    id: x.id, nom: x.fournisseur?.nom ?? x.fournisseurNom, fournisseurId: x.fournisseurId ?? null, numero: x.numero,
    date: d(x.date), echeance: d(x.dateEcheance),
    joursRestants: joursAvant(x.dateEcheance, x.statut), datePaiement: d(x.datePaiement),
    montant: x.montantUSD.toString(), reste: Number(x.resteAPayerUSD), statut: x.statut,
    documentUrl: x.documentUrl ?? null,
  });
  // Groupement « fournisseur » : liste plate. Groupement « mois » : accordéon Année → Mois.
  const groupes: Groupe[] = [];
  const annees: AnneeGroupe[] = [];
  if (tri === "fournisseur") {
    const idx = new Map<string, number>();
    for (const x of factures) {
      const t = x.fournisseur?.nom ?? x.fournisseurNom;
      if (!idx.has(t)) { idx.set(t, groupes.length); groupes.push({ titre: t, factures: [] }); }
      groupes[idx.get(t)!].factures.push(toRow(x));
    }
  } else {
    const ai = new Map<number, number>();
    for (const x of factures) {
      if (!ai.has(x.annee)) { ai.set(x.annee, annees.length); annees.push({ annee: x.annee, mois: [] }); }
      const ag = annees[ai.get(x.annee)!];
      const cle = `${x.annee}-${String(x.mois).padStart(2, "0")}`;
      let mg = ag.mois.find((m) => m.cle === cle);
      if (!mg) { mg = { cle, label: `${MOIS_FR[x.mois - 1]} ${x.annee}`, factures: [] }; ag.mois.push(mg); }
      mg.factures.push(toRow(x));
    }
    annees.sort((a, b) => b.annee - a.annee);
    for (const a of annees) a.mois.sort((x, y) => y.cle.localeCompare(x.cle));
  }

  const lien = (params: Partial<SP>) => {
    const p = new URLSearchParams();
    const s = { statut: f, tri, vue, ...params };
    if (s.statut) p.set("statut", s.statut);
    if (s.tri && s.tri !== "mois") p.set("tri", s.tri);
    if (s.vue && s.vue !== "detail") p.set("vue", s.vue);
    return `/stock/factures${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Factures fournisseurs</h1>
        <div className="flex items-center gap-2">
          <Link href="/stock/factures/nouveau" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">+ Nouvelle facture</Link>
          {estDirection && <ImportFacturesBtn />}
          <BoutonRapport types={[{ value: "FACTURES", label: "Factures" }, { value: "PAIEMENTS", label: "Retards de paiement" }]} />
          <a href="/stock/factures/imprimer" target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">PDF</a>
          <a href="/stock/factures/export" download className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Excel</a>
        </div>
      </div>

      {/* KPIs épurés */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total facturé" valeur={usd(kpi.total)} />
        <Kpi label="Réglé" valeur={usd(kpi.regle)} accent="green" />
        <Kpi label="À payer" valeur={usd(kpi.du)} accent={kpi.du > 0 ? "amber" : undefined} />
        <Kpi label="Échu" valeur={usd(kpi.echu)} accent={kpi.echu > 0 ? "red" : undefined} />
      </div>

      {/* Bascule de vue */}
      <div className="flex flex-wrap gap-1.5 text-sm">
        <a href={lien({ vue: "detail" })} className={`rounded-full border px-3 py-1 ${vue === "detail" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Par mois</a>
        <a href={lien({ vue: "fournisseur" })} className={`rounded-full border px-3 py-1 ${vue === "fournisseur" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Soldes par fournisseur</a>
      </div>

      {vue === "fournisseur" ? (
        <div className="max-h-[70vh] overflow-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
                <th>Fournisseur</th>
                <th className="text-right">Solde dû</th>
                <th className="text-right">Total facturé</th>
                <th className="text-right">Factures</th>
                <th className="text-right">Cette année</th>
                <th className="text-right">Ce mois</th>
              </tr>
            </thead>
            <tbody>
              {parFournisseur.map((s) => (
                <tr key={s.nom} className="border-t even:bg-muted/25 hover:bg-accent/40">
                  <td className="px-3 py-2 font-medium">
                    {s.id ? <Link href={`/stock/fournisseurs/${s.id}`} className="text-primary hover:underline">{s.nom}</Link> : s.nom}
                  </td>
                  <td className="px-3 py-2 text-right">{s.solde > 0 ? <span className="font-semibold text-red-700">{usd(s.solde)}</span> : "—"}</td>
                  <td className="px-3 py-2 text-right">{usd(s.total)}</td>
                  <td className="px-3 py-2 text-right">{s.nb}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.nbAnnee}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{s.nbMois}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {[["", "Toutes"], ["du", "À payer"], ["ECHUE_NON_REGLEE", "Échues"], ["REGLEE", "Réglées"]].map(([k, label]) => (
                <a key={k} href={lien({ statut: k })} className={`rounded-full border px-3 py-1 ${(f ?? "") === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</a>
              ))}
            </div>
            <span className="text-muted-foreground">·</span>
            <div className="flex gap-1.5">
              <span className="text-muted-foreground">Grouper :</span>
              <a href={lien({ tri: "mois" })} className={`rounded-full border px-3 py-1 ${tri === "mois" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Mois</a>
              <a href={lien({ tri: "fournisseur" })} className={`rounded-full border px-3 py-1 ${tri === "fournisseur" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Fournisseur</a>
            </div>
          </div>
          {tri === "mois"
            ? <FacturesUI annees={annees} estDirection={estDirection} />
            : <FacturesUI groupes={groupes} estDirection={estDirection} />}
        </>
      )}
    </div>
  );
}

function Kpi({ label, valeur, accent }: { label: string; valeur: string; accent?: "green" | "amber" | "red" }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : accent === "green" ? "border-emerald-200 bg-emerald-50" : "";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{valeur}</p>
    </div>
  );
}
