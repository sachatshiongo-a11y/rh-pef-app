import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { DOMAINE_LABEL, STATUT_BC_LABEL, STATUT_BC_CLASSE, usd } from "@/lib/stock";
import { grouperParMois } from "@/lib/dates-fr";
import { MoisAccordeon } from "@/components/mois-accordeon";

const jfr = (d: Date | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

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
  await verifySession();
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
      {vue === "rapports" && <Rapports />}
      {vue === "journal" && <Journal entite={sp.entite} userId={sp.userId} />}
    </div>
  );
}

async function Comptages() {
  const sessions = await prisma.sessionComptage.findMany({ orderBy: { date: "desc" }, take: 300 });
  if (sessions.length === 0) return <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun comptage archivé.</p>;
  const groupes = grouperParMois(sessions, (s) => s.date);
  return (
    <div className="space-y-2">
      {groupes.map((g, i) => (
        <MoisAccordeon key={g.cle} titre={g.titre} compteur={`${g.items.length} comptage(s)`} defaultOpen={i === 0}>
          <ul className="divide-y border-t text-sm">
            {g.items.map((s) => (
              <li key={s.id}>
                <Link href={`/stock/archives/${s.id}`} className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-accent/40">
                  <span className="min-w-0">
                    <span className="font-medium">{jfr(s.date)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.domaine ? DOMAINE_LABEL[s.domaine] ?? s.domaine : "Tous"} · {s.nbArticles} articles · {s.nbEcarts} écart(s)</span>
                  </span>
                  {s.nbHorsTol > 0 ? <span className="shrink-0 text-xs font-semibold text-red-700">{s.nbHorsTol} hors tol.</span> : <span className="shrink-0 text-xs text-muted-foreground">0 hors tol.</span>}
                </Link>
              </li>
            ))}
          </ul>
        </MoisAccordeon>
      ))}
    </div>
  );
}

async function BonsValides() {
  const bcs = await prisma.bonDeCommande.findMany({
    where: { statut: { notIn: ["BROUILLON", "ANNULE"] } },
    orderBy: [{ annee: "desc" }, { date: "desc" }],
    take: 300,
    include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } } },
  });
  if (bcs.length === 0) return <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun bon de commande validé.</p>;
  const groupes = grouperParMois(bcs, (b) => b.date);
  return (
    <div className="space-y-2">
      {groupes.map((g, i) => (
        <MoisAccordeon key={g.cle} titre={g.titre} compteur={`${g.items.length} bon(s)`} resume={usd(g.items.reduce((t, b) => t + Number(b.totalUSD), 0))} defaultOpen={i === 0}>
          <ul className="divide-y border-t text-sm">
            {g.items.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-accent/40">
                <span className="min-w-0">
                  <Link href={`/stock/commandes/${b.id}`} className="font-medium text-primary hover:underline">{b.numero}</Link>
                  <span className="ml-2 text-xs text-muted-foreground">{b.fournisseur?.nom ?? "—"} · {jfr(b.date)} · {b._count.lignes} ligne(s)</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span>
                  <span className="font-semibold tabular-nums">{usd(b.totalUSD)}</span>
                </span>
              </li>
            ))}
          </ul>
        </MoisAccordeon>
      ))}
    </div>
  );
}

const moisISO = (d: Date | null) => (d ? `${new Date(d).getUTCFullYear()}-${String(new Date(d).getUTCMonth() + 1).padStart(2, "0")}` : "");

async function Rapports() {
  const rapports = await prisma.rapport.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  if (rapports.length === 0) return <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun rapport généré. Utilisez le bouton « Rapport » dans les onglets concernés.</p>;
  const groupes = grouperParMois(rapports, (r) => r.createdAt);
  const periode = (r: (typeof rapports)[number]) =>
    `${r.periodeDebut ? new Date(r.periodeDebut).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"} → ${r.periodeFin ? new Date(r.periodeFin).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"}`;
  return (
    <div className="space-y-2">
      {groupes.map((g, i) => (
        <MoisAccordeon key={g.cle} titre={g.titre} compteur={`${g.items.length} rapport(s)`} defaultOpen={i === 0}>
          <ul className="divide-y border-t text-sm">
            {g.items.map((r) => {
              const url = `/stock/rapports/export?type=${r.type}&mode=${r.mode}&format=${r.format}&debut=${moisISO(r.periodeDebut)}&fin=${moisISO(r.periodeFin)}`;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-accent/40">
                  <span className="min-w-0">
                    <span className="font-medium">{TYPE_RAPPORT_LABEL[r.type] ?? r.type}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{r.mode === "detail" ? "Détaillé" : "Chiffré"} · {r.format.toUpperCase()} · {periode(r)} · généré le {jfr(r.createdAt)}</span>
                  </span>
                  <a href={url} download target="_blank" rel="noopener" className="shrink-0 rounded border px-2.5 py-1 text-xs font-medium hover:bg-accent">Télécharger</a>
                </li>
              );
            })}
          </ul>
        </MoisAccordeon>
      ))}
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

      {entrees.length === 0 ? (
        <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucune activité enregistrée.</p>
      ) : (
        <div className="space-y-2">
          {grouperParMois(entrees, (e) => e.date).map((g, i) => (
            <MoisAccordeon key={g.cle} titre={g.titre} compteur={`${g.items.length} entrée(s)`} defaultOpen={i === 0}>
              <ul className="divide-y border-t text-sm">
                {g.items.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="font-medium">{ENTITE_LABEL[e.entite] ?? e.entite}</span> <span className="text-xs text-muted-foreground">· {e.champ}</span>
                      <span className="block truncate text-xs text-muted-foreground">{e.nouvelleValeur ?? e.ancienneValeur ?? "—"}{e.user?.nom ? ` · ${e.user.nom}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(e.date).toLocaleString("fr-FR")}</span>
                  </li>
                ))}
              </ul>
            </MoisAccordeon>
          ))}
        </div>
      )}
    </div>
  );
}
