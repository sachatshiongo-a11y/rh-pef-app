import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DOMAINE_LABEL } from "@/lib/stock";

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
  const vue = sp.vue === "rapports" ? "rapports" : sp.vue === "journal" ? "journal" : "comptages";

  const onglets: [string, string][] = [["comptages", "Comptages"], ["rapports", "Rapports générés"], ["journal", "Journal d'activité"]];

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
      {vue === "rapports" && <Rapports />}
      {vue === "journal" && <Journal entite={sp.entite} userId={sp.userId} />}
    </div>
  );
}

async function Comptages() {
  const sessions = await prisma.sessionComptage.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="overflow-x-auto rounded-lg border">
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
  );
}

async function Rapports() {
  const rapports = await prisma.rapport.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-muted/50 text-left"><tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold"><th>Rapport</th><th>Catégorie</th><th>Période</th><th>Généré le</th></tr></thead>
        <tbody>
          {rapports.map((r) => (
            <tr key={r.id} className="border-t even:bg-muted/25">
              <td className="px-3 py-2 font-medium">{r.titre}</td>
              <td className="px-3 py-2 text-muted-foreground">{TYPE_RAPPORT_LABEL[r.type] ?? r.type}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.periodeDebut ? new Date(r.periodeDebut).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"} → {r.periodeFin ? new Date(r.periodeFin).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{new Date(r.createdAt).toLocaleString("fr-FR")}</td>
            </tr>
          ))}
          {rapports.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Aucun rapport généré. Générez-en depuis l’onglet Rapports.</td></tr>}
        </tbody>
      </table>
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

      <div className="overflow-x-auto rounded-lg border">
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
