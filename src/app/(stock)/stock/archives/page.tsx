import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { DOMAINE_LABEL, STATUT_BC_LABEL, STATUT_BC_CLASSE, usd } from "@/lib/stock";
import { BoutonSupprimerTout } from "../_rapport/bouton-supprimer-tout";
import { supprimerTousRapports } from "./actions";

type SP = { vue?: string; entite?: string; userId?: string };

// Entités du domaine Stock à afficher dans le journal d'activité.
const STOCK_ENTITES = ["ArticleStock", "BonDeCommande", "FactureFournisseur", "MouvementStock", "SessionComptage", "Fournisseur", "LigneFacture", "ArticleResto", "AchatLegume", "Stock", "LigneComptage"];
const ENTITE_LABEL: Record<string, string> = {
  ArticleStock: "Article", BonDeCommande: "Bon de commande", FactureFournisseur: "Facture", MouvementStock: "Mouvement",
  SessionComptage: "Comptage", Fournisseur: "Fournisseur", LigneFacture: "Ligne facture", ArticleResto: "Article resto",
  AchatLegume: "Achat légumes", Stock: "Stock", LigneComptage: "Ligne comptage",
};
const TYPE_RAPPORT_LABEL: Record<string, string> = {
  FACTURES: "Factures", BONS_COMMANDE: "Bons de commande", PAIEMENTS: "Retards de paiement",
  ACHATS: "Achats", MOUVEMENTS: "Mouvements", LEGUMES: "Achats légumes",
};

export default async function ArchivesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const vue = sp.vue === "rapports" ? "rapports" : sp.vue === "journal" ? "journal" : sp.vue === "bons" ? "bons" : "comptages";

  const onglets: [string, string][] = [["comptages", "Comptages"], ["bons", "Bons de commande validés"], ["rapports", "Rapports générés"], ["journal", "Journal d'activité"]];

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Archives</h1>
        <p className="mt-1 text-sm text-muted-foreground">Historique de l’application : comptages d’inventaire, rapports générés et journal d’activité.</p>
      </div>

      <div className="flex flex-wrap gap-1.5 text-sm">
        {onglets.map(([k, label]) => (
          <a key={k} href={`/stock/archives?vue=${k}`} className={`rounded-full border px-3 py-1 ${vue === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</a>
        ))}
      </div>

      {vue === "comptages" && <Comptages />}
      {vue === "bons" && <BonsValides />}
      {vue === "rapports" && <Rapports estDirection={estDirection} />}
      {vue === "journal" && <Journal entite={sp.entite} userId={sp.userId} />}
    </div>
  );
}

async function Comptages() {
  const sessions = await prisma.sessionComptage.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <>
    <div className="space-y-2 lg:hidden">
      {sessions.map((s) => (
        <Link key={s.id} href={`/stock/archives/${s.id}`} className="block rounded-xl border bg-card p-3 active:bg-accent">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{new Date(s.date).toLocaleDateString("fr-FR")}</span>
            <span className="text-xs text-muted-foreground">{s.domaine ? DOMAINE_LABEL[s.domaine] ?? s.domaine : "Tous"}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{s.nbArticles} articles</span>
            <span>{s.nbEcarts} écart(s)</span>
            {s.nbHorsTol > 0 ? <span className="font-semibold text-red-700">{s.nbHorsTol} hors tolérance</span> : <span>0 hors tolérance</span>}
          </div>
        </Link>
      ))}
      {sessions.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun comptage archivé.</p>}
    </div>
    <div className="hidden overflow-x-auto rounded-lg border lg:block">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-muted/50 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold"><th>Date</th><th>Domaine</th><th className="text-right">Articles</th><th className="text-right">Écarts</th><th className="text-right">Hors tolérance</th><th></th></tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-t even:bg-muted/25 hover:bg-accent/40">
              <td className="px-3 py-2 font-medium">{new Date(s.date).toLocaleDateString("fr-FR")}</td>
              <td className="px-3 py-2 text-muted-foreground">{s.domaine ? DOMAINE_LABEL[s.domaine] ?? s.domaine : "Tous"}</td>
              <td className="px-3 py-2 text-right">{s.nbArticles}</td>
              <td className="px-3 py-2 text-right">{s.nbEcarts}</td>
              <td className="px-3 py-2 text-right">{s.nbHorsTol > 0 ? <span className="font-semibold text-red-700">{s.nbHorsTol}</span> : "0"}</td>
              <td className="px-3 py-2 text-right"><Link href={`/stock/archives/${s.id}`} className="text-primary underline">Ouvrir</Link></td>
            </tr>
          ))}
          {sessions.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun comptage archivé.</td></tr>}
        </tbody>
      </table>
    </div>
    </>
  );
}

async function BonsValides() {
  const bcs = await prisma.bonDeCommande.findMany({
    where: { statut: { notIn: ["BROUILLON", "ANNULE"] } },
    orderBy: [{ annee: "desc" }, { date: "desc" }],
    take: 200,
    include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } } },
  });
  return (
    <>
    {/* Mobile : cartes. */}
    <div className="space-y-2 lg:hidden">
      {bcs.map((b) => (
        <div key={b.id} className="rounded-xl border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/stock/commandes/${b.id}`} className="font-medium text-primary hover:underline">{b.numero}</Link>
              <div className="truncate text-xs text-muted-foreground">{b.fournisseur?.nom ?? "—"} · {new Date(b.date).toLocaleDateString("fr-FR")}</div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-sm"><span className="text-muted-foreground">{b._count.lignes} ligne(s)</span><span className="font-semibold tabular-nums">{usd(b.totalUSD)}</span></div>
        </div>
      ))}
      {bcs.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun bon de commande validé.</p>}
    </div>
    {/* Ordinateur : tableau. */}
    <div className="hidden overflow-x-auto rounded-lg border lg:block">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-muted/50 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold"><th>Numéro</th><th>Fournisseur</th><th>Date</th><th className="text-right">Total</th><th>Statut</th><th></th></tr></thead>
        <tbody>
          {bcs.map((b) => (
            <tr key={b.id} className="border-t even:bg-muted/25 hover:bg-accent/40">
              <td className="px-3 py-2 font-medium">{b.numero}</td>
              <td className="px-3 py-2">{b.fournisseur?.nom ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{new Date(b.date).toLocaleDateString("fr-FR")}</td>
              <td className="px-3 py-2 text-right">{usd(b.totalUSD)}</td>
              <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span></td>
              <td className="px-3 py-2 text-right"><Link href={`/stock/commandes/${b.id}`} className="text-primary underline">Ouvrir</Link></td>
            </tr>
          ))}
          {bcs.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun bon de commande validé.</td></tr>}
        </tbody>
      </table>
    </div>
    </>
  );
}

const moisISO = (d: Date | null) => (d ? `${new Date(d).getUTCFullYear()}-${String(new Date(d).getUTCMonth() + 1).padStart(2, "0")}` : "");

async function Rapports({ estDirection }: { estDirection: boolean }) {
  const rapports = await prisma.rapport.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="space-y-3">
      {estDirection && rapports.length > 0 && (
        <div className="flex justify-end">
          <BoutonSupprimerTout estDirection={estDirection} action={supprimerTousRapports} libelle="Supprimer TOUS les rapports générés ?" />
        </div>
      )}
      {/* Mobile : cartes. */}
      <div className="space-y-2 lg:hidden">
        {rapports.map((r) => {
          const url = `/stock/rapports/export?type=${r.type}&mode=${r.mode}&format=${r.format}&debut=${moisISO(r.periodeDebut)}&fin=${moisISO(r.periodeFin)}`;
          return (
            <div key={r.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{TYPE_RAPPORT_LABEL[r.type] ?? r.type} <span className="text-xs font-normal text-muted-foreground">· {r.mode === "detail" ? "Détaillé" : "Chiffré"} · {r.format.toUpperCase()}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {r.periodeDebut ? new Date(r.periodeDebut).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"} → {r.periodeFin ? new Date(r.periodeFin).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"} · généré le {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                  </div>
                </div>
                <a href={url} download target="_blank" rel="noopener" className="shrink-0 rounded border px-2 py-1 text-xs font-medium hover:bg-accent">Télécharger</a>
              </div>
            </div>
          );
        })}
        {rapports.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun rapport généré. Utilisez le bouton « Rapport » dans les onglets concernés.</p>}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border lg:block">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-muted/50 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold"><th>Rapport</th><th>Type</th><th>Format</th><th>Période</th><th>Généré le</th><th></th></tr></thead>
        <tbody>
          {rapports.map((r) => {
            const url = `/stock/rapports/export?type=${r.type}&mode=${r.mode}&format=${r.format}&debut=${moisISO(r.periodeDebut)}&fin=${moisISO(r.periodeFin)}`;
            return (
              <tr key={r.id} className="border-t even:bg-muted/25 hover:bg-accent/40">
                <td className="px-3 py-2 font-medium">{TYPE_RAPPORT_LABEL[r.type] ?? r.type}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.mode === "detail" ? "Détaillé" : "Chiffré"}</td>
                <td className="px-3 py-2 uppercase text-muted-foreground">{r.format}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.periodeDebut ? new Date(r.periodeDebut).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"} → {r.periodeFin ? new Date(r.periodeFin).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{new Date(r.createdAt).toLocaleString("fr-FR")}</td>
                <td className="px-3 py-2 text-right"><a href={url} download target="_blank" rel="noopener" className="rounded border px-2 py-1 text-xs font-medium hover:bg-accent">Télécharger</a></td>
              </tr>
            );
          })}
          {rapports.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun rapport généré. Utilisez le bouton « Rapport » dans les onglets concernés.</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  );
}

async function Journal({ entite, userId }: { entite?: string; userId?: string }) {
  const filtreEntite = entite && STOCK_ENTITES.includes(entite) ? entite : undefined;
  const filtreUser = userId || undefined;

  const [entrees, users] = await Promise.all([
    prisma.journalAudit.findMany({
      where: { entite: filtreEntite ? filtreEntite : { in: STOCK_ENTITES }, ...(filtreUser ? { userId: filtreUser } : {}) },
      orderBy: { date: "desc" },
      take: 300,
      include: { user: { select: { nom: true } } },
    }),
    prisma.user.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);

  return (
    <div className="space-y-3">
      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="vue" value="journal" />
        <select name="entite" defaultValue={filtreEntite ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les types</option>
          {STOCK_ENTITES.map((e) => <option key={e} value={e}>{ENTITE_LABEL[e] ?? e}</option>)}
        </select>
        <select name="userId" defaultValue={filtreUser ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Toutes les personnes</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.nom}</option>)}
        </select>
        <button className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        {(filtreEntite || filtreUser) && <Link href="/stock/archives?vue=journal" className="text-muted-foreground underline">Réinitialiser</Link>}
        <span className="text-xs text-muted-foreground">{entrees.length} entrée(s)</span>
      </form>

      {/* Mobile : cartes. */}
      <div className="space-y-2 lg:hidden">
        {entrees.map((e) => (
          <div key={e.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{ENTITE_LABEL[e.entite] ?? e.entite} <span className="text-xs font-normal text-muted-foreground">· {e.champ}</span></span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(e.date).toLocaleString("fr-FR")}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{e.nouvelleValeur ?? e.ancienneValeur ?? "—"}{e.user?.nom ? ` · ${e.user.nom}` : ""}</div>
          </div>
        ))}
        {entrees.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucune activité enregistrée.</p>}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border lg:block">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-muted/50 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold"><th>Quand</th><th>Type</th><th>Action</th><th>Détail</th><th>Par</th></tr></thead>
        <tbody>
          {entrees.map((e) => (
            <tr key={e.id} className="border-t even:bg-muted/25">
              <td className="px-3 py-2 text-muted-foreground">{new Date(e.date).toLocaleString("fr-FR")}</td>
              <td className="px-3 py-2">{ENTITE_LABEL[e.entite] ?? e.entite}</td>
              <td className="px-3 py-2 text-muted-foreground">{e.champ}</td>
              <td className="px-3 py-2 text-muted-foreground">{e.nouvelleValeur ?? e.ancienneValeur ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{e.user?.nom ?? "—"}</td>
            </tr>
          ))}
          {entrees.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucune activité enregistrée.</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  );
}
