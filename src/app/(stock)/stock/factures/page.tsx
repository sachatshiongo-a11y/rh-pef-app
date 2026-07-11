import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { usd } from "@/lib/stock";
import { FacturesUI, type FactureRow, type Groupe, type AnneeGroupe } from "./factures-client";
import { ImportFacturesBtn } from "./import-factures-btn";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { lundiDe, MOIS_FR_COURT, MOIS_FR_MAJ as MOIS_FR } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";

type SP = { statut?: string; tri?: string; vue?: string };
const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : null);
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
  const vue = sp.vue === "fournisseur" ? "fournisseur" : sp.vue === "echeancier" ? "echeancier" : "detail";
  const where: Prisma.FactureFournisseurWhereInput =
    f === "du" ? { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }
      : f === "A_REGLER" || f === "REGLEE" || f === "ECHUE_NON_REGLEE" ? { statut: f } : {};
  const orderBy: Prisma.FactureFournisseurOrderByWithRelationInput[] =
    tri === "fournisseur" ? [{ fournisseurNom: "asc" }, { annee: "desc" }, { mois: "desc" }] : [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }];

  // KPIs et soldes calculés en SQL (agrégats) : on ne recharge plus TOUTE la table à chaque affichage.
  const [factures, kpiRows, config] = await Promise.all([
    prisma.factureFournisseur.findMany({ where, orderBy, include: { fournisseur: { select: { nom: true } } } }),
    prisma.$queryRaw<{ total: number; regle: number; du: number; echu: number; nbTotal: number; nbReglees: number; nbDues: number; nbEchues: number }[]>`
      SELECT COALESCE(SUM("montantUSD"), 0)::float                                              AS total,
             COUNT(*)::int                                                                      AS "nbTotal",
             COALESCE(SUM("montantUSD" - "resteAPayerUSD"), 0)::float                           AS regle,
             COUNT(*) FILTER (WHERE statut = 'REGLEE')::int                                     AS "nbReglees",
             COALESCE(SUM("resteAPayerUSD") FILTER (WHERE statut <> 'REGLEE'), 0)::float        AS du,
             COUNT(*) FILTER (WHERE statut <> 'REGLEE')::int                                    AS "nbDues",
             COALESCE(SUM("resteAPayerUSD") FILTER (WHERE statut = 'ECHUE_NON_REGLEE'), 0)::float AS echu,
             COUNT(*) FILTER (WHERE statut = 'ECHUE_NON_REGLEE')::int                           AS "nbEchues"
      FROM "stock"."FactureFournisseur"`,
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);
  const kpi = kpiRows[0] ?? { total: 0, regle: 0, du: 0, echu: 0, nbTotal: 0, nbReglees: 0, nbDues: 0, nbEchues: 0 };

  // Solde par fournisseur : agrégé en SQL, et seulement quand la vue « fournisseur » est affichée.
  const anneeC = config?.anneeCourante ?? new Date().getFullYear();
  const moisC = config?.moisCourant ?? new Date().getMonth() + 1;
  const tauxCDF = config ? Number(config.tauxChangeCDF) : 0;
  const cdfEq = (v: number) => (tauxCDF > 0 && v > 0 ? ` · ≈ ${Math.round(v * tauxCDF).toLocaleString("fr-FR")} CDF` : "");
  const parFournisseur = vue === "fournisseur"
    ? await prisma.$queryRaw<{ id: string | null; nom: string; solde: number; total: number; nb: number; nbAnnee: number; nbMois: number }[]>`
        SELECT COALESCE(f."nom", x."fournisseurNom")                                            AS nom,
               (ARRAY_AGG(x."fournisseurId") FILTER (WHERE x."fournisseurId" IS NOT NULL))[1]   AS id,
               COALESCE(SUM(x."resteAPayerUSD") FILTER (WHERE x.statut <> 'REGLEE'), 0)::float  AS solde,
               COALESCE(SUM(x."montantUSD"), 0)::float                                          AS total,
               COUNT(*)::int                                                                    AS nb,
               COUNT(*) FILTER (WHERE x.annee = ${anneeC})::int                                 AS "nbAnnee",
               COUNT(*) FILTER (WHERE x.annee = ${anneeC} AND x.mois = ${moisC})::int           AS "nbMois"
        FROM "stock"."FactureFournisseur" x
        LEFT JOIN "stock"."Fournisseur" f ON f."id" = x."fournisseurId"
        GROUP BY 1
        ORDER BY solde DESC, total DESC`
    : [];

  // Échéancier de trésorerie : les factures dues, groupées par semaine d'échéance, avec cumul.
  type EchLigne = { id: string; nom: string; fournisseurId: string | null; numero: string | null; echeance: string | null; reste: number };
  type EchGroupe = { cle: string; titre: string; retard?: boolean; lignes: EchLigne[]; sousTotal: number };
  const echeancier: EchGroupe[] = [];
  if (vue === "echeancier") {
    const dues = await prisma.factureFournisseur.findMany({
      where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] }, resteAPayerUSD: { gt: 0 } },
      orderBy: [{ dateEcheance: { sort: "asc", nulls: "last" } }],
      include: { fournisseur: { select: { nom: true } } },
    });
    const auj = new Date();
    const auj0 = Date.UTC(auj.getUTCFullYear(), auj.getUTCMonth(), auj.getUTCDate());
    const idx = new Map<string, number>();
    for (const x of dues) {
      let cle: string, titre: string, retard = false;
      if (!x.dateEcheance) { cle = "zz-sans"; titre = "Sans échéance"; }
      else if (new Date(x.dateEcheance).getTime() < auj0) { cle = "aa-retard"; titre = "En retard"; retard = true; }
      else {
        const lundi = lundiDe(new Date(x.dateEcheance));
        const dim = new Date(lundi); dim.setUTCDate(dim.getUTCDate() + 6);
        cle = lundi.toISOString().slice(0, 10);
        titre = `Semaine du ${lundi.getUTCDate()} ${MOIS_FR_COURT[lundi.getUTCMonth()]} au ${dim.getUTCDate()} ${MOIS_FR_COURT[dim.getUTCMonth()]}`;
      }
      if (!idx.has(cle)) { idx.set(cle, echeancier.length); echeancier.push({ cle, titre, retard, lignes: [], sousTotal: 0 }); }
      const g = echeancier[idx.get(cle)!];
      g.lignes.push({ id: x.id, nom: x.fournisseur?.nom ?? x.fournisseurNom, fournisseurId: x.fournisseurId ?? null, numero: x.numero, echeance: d(x.dateEcheance), reste: Number(x.resteAPayerUSD) });
      g.sousTotal += Number(x.resteAPayerUSD);
    }
    echeancier.sort((a, b) => a.cle.localeCompare(b.cle));
  }

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
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/stock/factures/nouveau" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">+ Nouvelle facture</Link>
          {estDirection && <ImportFacturesBtn />}
          <BoutonRapport types={[{ value: "FACTURES", label: "Factures" }, { value: "PAIEMENTS", label: "Retards de paiement" }]} pdfHref="/stock/factures/imprimer" excelHref="/stock/factures/export" />
        </div>
      </div>

      {/* KPIs épurés — cliquables : chaque carte applique le filtre correspondant. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total facturé" valeur={usd(kpi.total)} sous={`${kpi.nbTotal} facture(s)${cdfEq(kpi.total)}`} href={lien({ statut: "" })} />
        <Kpi label="Réglé" valeur={usd(kpi.regle)} sous={`${kpi.nbReglees} réglée(s)${cdfEq(kpi.regle)}`} accent="green" href={lien({ statut: "REGLEE" })} />
        <Kpi label="À payer (dont échu)" valeur={usd(kpi.du)} sous={`${kpi.nbDues} à régler${cdfEq(kpi.du)}`} accent={kpi.du > 0 ? "amber" : undefined} href={lien({ statut: "du" })} />
        <Kpi label="Échu" valeur={usd(kpi.echu)} sous={`${kpi.nbEchues} échue(s)${cdfEq(kpi.echu)}`} accent={kpi.echu > 0 ? "red" : undefined} href={lien({ statut: "ECHUE_NON_REGLEE" })} />
      </div>

      {/* Bascule de vue */}
      <div className="flex flex-wrap gap-1.5 text-sm">
        <a href={lien({ vue: "detail" })} className={`rounded-full border px-3 py-1 ${vue === "detail" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Par mois</a>
        <a href={lien({ vue: "fournisseur" })} className={`rounded-full border px-3 py-1 ${vue === "fournisseur" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Soldes par fournisseur</a>
        <a href={lien({ vue: "echeancier" })} className={`rounded-full border px-3 py-1 ${vue === "echeancier" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Échéancier</a>
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
      ) : vue === "echeancier" ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Ce qu&apos;il y a à sortir, semaine par semaine (reste à payer des factures non réglées). Le cumul aide à planifier la trésorerie.</p>
          {echeancier.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucune facture à payer — tout est réglé. 🎉</p>}
          {(() => { let cumul = 0; return echeancier.map((g) => { cumul += g.sousTotal; const cum = cumul; return (
            <div key={g.cle} className={`overflow-hidden rounded-lg border ${g.retard ? "border-red-300" : ""}`}>
              <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm font-semibold ${g.retard ? "bg-red-50 text-red-800" : "bg-muted/50"}`}>
                <span>{g.retard ? "⚠ " : ""}{g.titre} <span className="font-normal text-muted-foreground">· {g.lignes.length} facture(s)</span></span>
                <span className="tabular-nums">{usd(g.sousTotal)} <span className="text-xs font-normal text-muted-foreground">· cumul {usd(cum)}</span></span>
              </div>
              <ul className="divide-y text-sm">
                {g.lignes.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1">
                    <span className="min-w-0 truncate">
                      {l.fournisseurId ? <Link href={`/stock/fournisseurs/${l.fournisseurId}`} className="font-medium text-primary hover:underline">{l.nom}</Link> : <span className="font-medium">{l.nom}</span>}
                      <span className="text-xs text-muted-foreground"> {l.numero ? `· N° ${l.numero}` : ""}{l.echeance ? ` · éch. ${l.echeance}` : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-semibold tabular-nums">{usd(l.reste)}</span>
                      <Link href={`/stock/factures/${l.id}`} className="text-xs text-primary underline">Détail</Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ); }); })()}
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

function Kpi({ label, valeur, sous, accent, href }: { label: string; valeur: string; sous?: string; accent?: "green" | "amber" | "red"; href?: string }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : accent === "green" ? "border-emerald-200 bg-emerald-50" : "";
  const contenu = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{valeur}</p>
      {sous && <p className="mt-0.5 text-[11px] text-muted-foreground">{sous}</p>}
    </>
  );
  return href
    ? <Link href={href} className={`block rounded-lg border p-3 transition-colors hover:border-primary ${cls}`} title="Filtrer la liste">{contenu}</Link>
    : <div className={`rounded-lg border p-3 ${cls}`}>{contenu}</div>;
}
