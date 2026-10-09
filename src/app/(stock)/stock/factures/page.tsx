import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { usd } from "@/lib/stock";
import { FacturesUI, type FactureRow, type Groupe, type AnneeGroupe } from "./factures-client";
import { ImportFacturesBtn } from "./import-factures-btn";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { lundiDe, MOIS_FR_COURT, MOIS_FR_MAJ as MOIS_FR } from "@/lib/dates-fr";
import type { Prisma } from "@prisma/client";
import { exigerPageStock } from "@/lib/garde-page";
import { numeroMoisCourantKinshasa, anneeCouranteKinshasa, jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { ciblesEnAttente } from "@/lib/validations-stock/apercu";
import { versFactureRow } from "./facture-row";
import { STATUTS_FACTURE_A_REGLER } from "@/lib/fiche-fournisseur";
import { LienGardantTaille } from "@/components/pagination";
import { lirePagination } from "@/lib/pagination";
import { aDesFrancs, additionnerTotaux, ajouterAuTotal, formaterMontantFacture, libelleEquivalent, libelleTotal, montantsFacture, totalVide, type DeviseFacture, type TotalDevises } from "@/lib/facture-devise";

type SP = { statut?: string; tri?: string; vue?: string; annee?: string; page?: string; par?: string };
const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : null);

export default async function FacturesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const { page, par } = lirePagination(sp);
  const estDirection = user.role === "ADMIN";
  const f = sp.statut;
  const tri = sp.tri === "fournisseur" ? "fournisseur" : "mois";
  const vue = sp.vue === "fournisseur" ? "fournisseur" : sp.vue === "echeancier" ? "echeancier" : "detail";
  // Arrivée depuis le tableau de bord (filtre « à payer » ou « échues ») → accordéons déroulés d'emblée.
  const filtreImpayes = f === "du" || f === "A_REGLER" || f === "ECHUE_NON_REGLEE";
  const ouvertParDefaut = filtreImpayes;

  // Liste BORNÉE par année (défaut : année courante) — la table grandit sans fin, on ne la
  // recharge plus entièrement. Exceptions voulues : les vues d'impayés couvrent TOUTES les
  // années (masquer une vieille dette serait pire que tout), « Toutes » reste accessible.
  const [anneesRows, configAnnee] = await Promise.all([
    prisma.factureFournisseur.groupBy({ by: ["annee"], orderBy: { annee: "desc" } }),
    prisma.config.findUnique({ where: { id: "singleton" }, select: { anneeCourante: true } }),
  ]);
  const anneesDispo = anneesRows.map((r) => r.annee);
  const anneeDefaut = configAnnee?.anneeCourante ?? anneeCouranteKinshasa();
  const anneeSel: number | null =
    filtreImpayes || sp.annee === "toutes" ? null : Number(sp.annee) || anneeDefaut;

  const where: Prisma.FactureFournisseurWhereInput = {
    ...(f === "du" ? { statut: { in: STATUTS_FACTURE_A_REGLER } }
      : f === "A_REGLER" || f === "REGLEE" || f === "ECHUE_NON_REGLEE" ? { statut: f } : {}),
    ...(anneeSel ? { annee: anneeSel } : {}),
  };
  const orderBy: Prisma.FactureFournisseurOrderByWithRelationInput[] =
    tri === "fournisseur" ? [{ fournisseurNom: "asc" }, { annee: "desc" }, { mois: "desc" }] : [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }];

  // KPIs et soldes calculés en SQL (agrégats) : on ne recharge plus TOUTE la table à chaque affichage.
  const [factures, kpiRows, config, enAttente] = await Promise.all([
    prisma.factureFournisseur.findMany({ where, orderBy, include: { fournisseur: { select: { nom: true } } } }),
    // Par devise (2026-10-09) : une facture en dollars a ses colonnes en francs NULLES et inversement,
    // donc chaque somme est exactement le total de sa devise — jamais additionnées entre elles.
    prisma.$queryRaw<{ total: number; regle: number; du: number; echu: number; totalCDF: number; regleCDF: number; duCDF: number; echuCDF: number; nbTotal: number; nbReglees: number; nbDues: number; nbEchues: number; nbCDF: number }[]>`
      SELECT COALESCE(SUM("montantUSD"), 0)::float                                              AS total,
             COALESCE(SUM("montantCDF"), 0)::float                                              AS "totalCDF",
             COALESCE(SUM("montantCDF" - "resteAPayerCDF"), 0)::float                           AS "regleCDF",
             COALESCE(SUM("resteAPayerCDF") FILTER (WHERE statut <> 'REGLEE'), 0)::float        AS "duCDF",
             COALESCE(SUM("resteAPayerCDF") FILTER (WHERE statut = 'ECHUE_NON_REGLEE'), 0)::float AS "echuCDF",
             COUNT(*) FILTER (WHERE "devise" = 'CDF')::int                                      AS "nbCDF",
             COUNT(*)::int                                                                      AS "nbTotal",
             COALESCE(SUM("montantUSD" - "resteAPayerUSD"), 0)::float                           AS regle,
             COUNT(*) FILTER (WHERE statut = 'REGLEE')::int                                     AS "nbReglees",
             COALESCE(SUM("resteAPayerUSD") FILTER (WHERE statut <> 'REGLEE'), 0)::float        AS du,
             COUNT(*) FILTER (WHERE statut <> 'REGLEE')::int                                    AS "nbDues",
             COALESCE(SUM("resteAPayerUSD") FILTER (WHERE statut = 'ECHUE_NON_REGLEE'), 0)::float AS echu,
             COUNT(*) FILTER (WHERE statut = 'ECHUE_NON_REGLEE')::int                           AS "nbEchues"
      FROM "stock"."FactureFournisseur"`,
    prisma.config.findUnique({ where: { id: "singleton" } }),
    ciblesEnAttente(), // factures dont le paiement attend la Direction
  ]);
  const kpi = kpiRows[0] ?? { total: 0, regle: 0, du: 0, echu: 0, totalCDF: 0, regleCDF: 0, duCDF: 0, echuCDF: 0, nbTotal: 0, nbReglees: 0, nbDues: 0, nbEchues: 0, nbCDF: 0 };
  // Un total par devise : « 1 234,50 $ + 2 800 000 FC » (dollars seuls : l'affichage d'avant).
  const t = (usdV: number, cdfV: number): TotalDevises => ({ usd: usdV, cdf: cdfV, nbUSD: kpi.nbTotal - kpi.nbCDF, nbCDF: kpi.nbCDF });

  // Solde par fournisseur : agrégé en SQL, et seulement quand la vue « fournisseur » est affichée.
  const anneeC = config?.anneeCourante ?? anneeCouranteKinshasa();
  const moisC = config?.moisCourant ?? numeroMoisCourantKinshasa();
  const tauxCDF = config ? Number(config.tauxChangeCDF) : 0;
  const cdfEq = (v: number) => (tauxCDF > 0 && v > 0 ? ` · ≈ ${Math.round(v * tauxCDF).toLocaleString("fr-FR")} CDF` : "");
  // Total qui compte des francs : son équivalent unique en dollars, annoncé « ≈ » au taux du jour ; sinon, l'équivalent d'avant.
  const equivalent = (x: TotalDevises) => (aDesFrancs(x) ? ` · ${libelleEquivalent(x, tauxCDF)}` : cdfEq(x.usd));
  const parFournisseur = vue === "fournisseur"
    ? await prisma.$queryRaw<{ id: string | null; nom: string; solde: number; total: number; soldeCDF: number; totalCDF: number; nb: number; nbAnnee: number; nbMois: number }[]>`
        SELECT COALESCE(f."nom", x."fournisseurNom")                                            AS nom,
               (ARRAY_AGG(x."fournisseurId") FILTER (WHERE x."fournisseurId" IS NOT NULL))[1]   AS id,
               COALESCE(SUM(x."resteAPayerUSD") FILTER (WHERE x.statut <> 'REGLEE'), 0)::float  AS solde,
               COALESCE(SUM(x."montantUSD"), 0)::float                                          AS total,
               COALESCE(SUM(x."resteAPayerCDF") FILTER (WHERE x.statut <> 'REGLEE'), 0)::float  AS "soldeCDF",
               COALESCE(SUM(x."montantCDF"), 0)::float                                          AS "totalCDF",
               COUNT(*)::int                                                                    AS nb,
               COUNT(*) FILTER (WHERE x.annee = ${anneeC})::int                                 AS "nbAnnee",
               COUNT(*) FILTER (WHERE x.annee = ${anneeC} AND x.mois = ${moisC})::int           AS "nbMois"
        FROM "stock"."FactureFournisseur" x
        LEFT JOIN "stock"."Fournisseur" f ON f."id" = x."fournisseurId"
        GROUP BY 1
        ORDER BY solde DESC, "soldeCDF" DESC, total DESC, "totalCDF" DESC`
    : [];
  // Tri sur le solde dû TOUTES devises : dollars + francs ÷ taux du jour (sinon 5 000 000 FC passeraient
  // après 0,01 $ — relecture). Sans taux, l'ordre SQL (dollars d'abord) est gardé.
  if (tauxCDF > 0) parFournisseur.sort((a, b) => (b.solde + b.soldeCDF / tauxCDF) - (a.solde + a.soldeCDF / tauxCDF) || (b.total + b.totalCDF / tauxCDF) - (a.total + a.totalCDF / tauxCDF));

  // Échéancier de trésorerie : les factures dues, groupées par semaine d'échéance, avec cumul.
  type EchLigne = { id: string; nom: string; fournisseurId: string | null; numero: string | null; echeance: string | null; reste: number; devise: DeviseFacture };
  type EchGroupe = { cle: string; titre: string; retard?: boolean; lignes: EchLigne[]; sousTotal: TotalDevises };
  const echeancier: EchGroupe[] = [];
  if (vue === "echeancier") {
    const dues = await prisma.factureFournisseur.findMany({
      where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] }, OR: [{ resteAPayerUSD: { gt: 0 } }, { resteAPayerCDF: { gt: 0 } }] },
      orderBy: [{ dateEcheance: { sort: "asc", nulls: "last" } }],
      include: { fournisseur: { select: { nom: true } } },
    });
    const auj0 = jourCivilKinshasa(new Date()).getTime(); // aujourd'hui à Kinshasa
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
      if (!idx.has(cle)) { idx.set(cle, echeancier.length); echeancier.push({ cle, titre, retard, lignes: [], sousTotal: totalVide() }); }
      const g = echeancier[idx.get(cle)!];
      const m = montantsFacture(x);
      g.lignes.push({ id: x.id, nom: x.fournisseur?.nom ?? x.fournisseurNom, fournisseurId: x.fournisseurId ?? null, numero: x.numero, echeance: d(x.dateEcheance), reste: m.reste, devise: m.devise });
      g.sousTotal = ajouterAuTotal(g.sousTotal, m.devise, m.reste);
    }
    echeancier.sort((a, b) => a.cle.localeCompare(b.cle));
  }

  const toRow = (x: (typeof factures)[number]): FactureRow => versFactureRow(x, enAttente.factures);
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

  const cleListe = [f, anneeSel, tri, vue].join("|");
  const lien = (params: Partial<SP>) => {
    const p = new URLSearchParams();
    const s = { statut: f, tri, vue, annee: sp.annee, ...params };
    if (s.statut) p.set("statut", s.statut);
    if (s.tri && s.tri !== "mois") p.set("tri", s.tri);
    if (s.vue && s.vue !== "detail") p.set("vue", s.vue);
    if (s.annee && s.annee !== String(anneeDefaut)) p.set("annee", s.annee);
    return `/stock/factures${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Factures fournisseurs</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/stock/factures/nouveau" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">+ Nouvelle facture</Link>
          {estDirection && <ImportFacturesBtn />}
          <BoutonRapport types={[{ value: "FACTURES", label: "Factures" }, { value: "PAIEMENTS", label: "Retards de paiement" }]} pdfHref="/stock/factures/imprimer" pdfPage excelHref="/stock/factures/export" />
        </div>
      </div>

      {/* KPIs épurés — cliquables : chaque carte applique le filtre correspondant. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total facturé" valeur={libelleTotal(t(kpi.total, kpi.totalCDF), undefined, usd)} sous={`${kpi.nbTotal} facture(s)${equivalent(t(kpi.total, kpi.totalCDF))}`} href={lien({ statut: "" })} />
        <Kpi label="Réglé" valeur={libelleTotal(t(kpi.regle, kpi.regleCDF), undefined, usd)} sous={`${kpi.nbReglees} réglée(s)${equivalent(t(kpi.regle, kpi.regleCDF))}`} accent="green" href={lien({ statut: "REGLEE" })} />
        <Kpi label="À payer (dont échu)" valeur={libelleTotal(t(kpi.du, kpi.duCDF), undefined, usd)} sous={`${kpi.nbDues} à régler${equivalent(t(kpi.du, kpi.duCDF))}`} accent={kpi.du > 0 || kpi.duCDF > 0 ? "amber" : undefined} href={lien({ statut: "du" })} />
        <Kpi label="Échu" valeur={libelleTotal(t(kpi.echu, kpi.echuCDF), undefined, usd)} sous={`${kpi.nbEchues} échue(s)${equivalent(t(kpi.echu, kpi.echuCDF))}`} accent={kpi.echu > 0 || kpi.echuCDF > 0 ? "red" : undefined} href={lien({ statut: "ECHUE_NON_REGLEE" })} />
      </div>

      {/* Bascule de vue */}
      <div className="flex flex-wrap gap-1.5 text-sm">
        <LienGardantTaille doux={false} href={lien({ vue: "detail" })} className={`rounded-full border px-3 py-1 ${vue === "detail" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Par mois</LienGardantTaille>
        <LienGardantTaille doux={false} href={lien({ vue: "fournisseur" })} className={`rounded-full border px-3 py-1 ${vue === "fournisseur" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Soldes par fournisseur</LienGardantTaille>
        <LienGardantTaille doux={false} href={lien({ vue: "echeancier" })} className={`rounded-full border px-3 py-1 ${vue === "echeancier" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Échéancier</LienGardantTaille>
      </div>

      {vue === "fournisseur" ? (
        <div className="tableau-normal rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="en-tete-collante bg-muted text-left">
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
                  <td className="px-3 py-2 text-right">{s.solde > 0 || s.soldeCDF > 0 ? <span className="font-semibold text-red-700">{libelleTotal({ usd: s.solde, cdf: s.soldeCDF, nbUSD: 0, nbCDF: 0 }, undefined, usd)}</span> : "—"}</td>
                  <td className="px-3 py-2 text-right">{libelleTotal({ usd: s.total, cdf: s.totalCDF, nbUSD: s.totalCDF > 0 ? 0 : 1, nbCDF: s.totalCDF > 0 ? 1 : 0 }, undefined, usd)}</td>
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
          {(() => { let cumul = totalVide(); return echeancier.map((g) => { cumul = additionnerTotaux(cumul, g.sousTotal); const cum = cumul; return (
            <div key={g.cle} className={`overflow-hidden rounded-lg border ${g.retard ? "border-red-300" : ""}`}>
              <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm font-semibold ${g.retard ? "bg-red-50 text-red-800" : "bg-muted/50"}`}>
                <span>{g.retard ? "⚠ " : ""}{g.titre} <span className="font-normal text-muted-foreground">· {g.lignes.length} facture(s)</span></span>
                <span className="tabular-nums">{libelleTotal(g.sousTotal, undefined, usd)} <span className="text-xs font-normal text-muted-foreground">· cumul {libelleTotal(cum, undefined, usd)}</span></span>
              </div>
              <ul className="divide-y text-sm">
                {g.lignes.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1">
                    <span className="min-w-0 truncate">
                      {l.fournisseurId ? <Link href={`/stock/fournisseurs/${l.fournisseurId}`} className="font-medium text-primary hover:underline">{l.nom}</Link> : <span className="font-medium">{l.nom}</span>}
                      <span className="text-xs text-muted-foreground"> {l.numero ? `· N° ${l.numero}` : ""}{l.echeance ? ` · éch. ${l.echeance}` : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-semibold tabular-nums">{l.devise === "USD" ? usd(l.reste) : formaterMontantFacture(l.reste, "CDF")}</span>
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
                <LienGardantTaille doux={false} key={k} href={lien({ statut: k })} className={`rounded-full border px-3 py-1 ${(f ?? "") === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</LienGardantTaille>
              ))}
            </div>
            <span className="text-muted-foreground">·</span>
            {filtreImpayes ? (
              <span className="text-xs text-muted-foreground">Impayés : toutes les années confondues.</span>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">Année :</span>
                {anneesDispo.map((a) => (
                  <LienGardantTaille doux={false} key={a} href={lien({ annee: String(a) })} className={`rounded-full border px-3 py-1 ${anneeSel === a ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{a}</LienGardantTaille>
                ))}
                <LienGardantTaille doux={false} href={lien({ annee: "toutes" })} className={`rounded-full border px-3 py-1 ${anneeSel === null ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Toutes</LienGardantTaille>
              </div>
            )}
            <span className="text-muted-foreground">·</span>
            <div className="flex gap-1.5">
              <span className="text-muted-foreground">Grouper :</span>
              <LienGardantTaille doux={false} href={lien({ tri: "mois" })} className={`rounded-full border px-3 py-1 ${tri === "mois" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Mois</LienGardantTaille>
              <LienGardantTaille doux={false} href={lien({ tri: "fournisseur" })} className={`rounded-full border px-3 py-1 ${tri === "fournisseur" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Fournisseur</LienGardantTaille>
            </div>
          </div>
          {tri === "mois"
            ? <FacturesUI annees={annees} estDirection={estDirection} ouvert={ouvertParDefaut} taux={tauxCDF} paginer pageInit={page} parInit={par} cleFiltre={cleListe} />
            : <FacturesUI groupes={groupes} estDirection={estDirection} ouvert={ouvertParDefaut} taux={tauxCDF} paginer pageInit={page} parInit={par} cleFiltre={cleListe} />}
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
    ? <LienGardantTaille href={href} className={`block rounded-lg border p-3 transition-colors hover:border-primary ${cls}`} title="Filtrer la liste">{contenu}</LienGardantTaille>
    : <div className={`rounded-lg border p-3 ${cls}`}>{contenu}</div>;
}
