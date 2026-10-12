import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { prisma } from "@/lib/prisma";
import { grouperParMois } from "@/lib/dates-fr";
import { MoisAccordeon } from "@/components/mois-accordeon";
import { redirect } from "next/navigation";
import { exigerPageStock } from "@/lib/garde-page";
import type { Prisma } from "@prisma/client";
import { TelechargerLien } from "@/components/telecharger-lien";
import { Pagination } from "@/components/pagination";
import { PLAFOND_TOUT, fenetrePage, groupePartiel, lirePagination, PAR_DEFAUT, type ParPage } from "@/lib/pagination";
import { OngletsDefilants } from "@/components/onglets-defilants";

const jfr = (d: Date | null) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

type SP = { vue?: string; entite?: string; userId?: string; page?: string; par?: string };

/** Pagination côté serveur (skip/take + count) : avant, chaque onglet s'arrêtait en silence aux 300 plus récents. */
type Pg = { page: number; par: ParPage; sp: SP };
/** Un mois coupé par une frontière de page ne montre que le compteur / le total de la PAGE : on le dit. */
const compteurMois = (n: number, partiel: boolean, mot: string) => `${n} ${mot}${partiel ? " sur cette page" : ""}`;

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
  await exigerPageStock();
  const sp = await searchParams;
  // Les comptages et les bons validés ont quitté les Archives (V3) : les anciennes adresses — dont la nue
  // « /stock/archives », qui ouvrait les comptages — arrivent là où ils sont maintenant.
  if (sp.vue === "bons") redirect("/stock/commandes?statut=VALIDE");
  if (sp.vue !== "rapports" && sp.vue !== "journal") {
    const q = new URLSearchParams({ vue: "comptages" });
    if (sp.page) q.set("page", sp.page);
    if (sp.par) q.set("par", sp.par);
    redirect(`/stock/reconciliation?${q}`);
  }
  const vue = sp.vue;
  const { page, par } = lirePagination(sp);
  const pg: Pg = { page, par, sp };

  const onglets: [string, string][] = [["rapports", "Rapports générés"], ["journal", "Journal d'activité"]];

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Archives</h1>
      </div>

      <OngletsDefilants
        libelle="Rubriques des archives"
        onglets={onglets.map(([k, label]) => ({ href: `/stock/archives?vue=${k}${par !== PAR_DEFAUT ? `&par=${par}` : ""}`, label, actif: vue === k }))}
      />

      {vue === "rapports" && <Rapports pg={pg} />}
      {vue === "journal" && <Journal entite={sp.entite} userId={sp.userId} pg={pg} />}
    </div>
  );
}

function BarrePages({ total, pg, page, libelle }: { total: number; pg: Pg; page: number; libelle: string }) {
  return <Pagination plafondTout={PLAFOND_TOUT} total={total} page={page} par={pg.par} chemin="/stock/archives" params={pg.sp} libelle={libelle} />;
}

const moisISO = (d: Date | null) => (d ? `${new Date(d).getUTCFullYear()}-${String(new Date(d).getUTCMonth() + 1).padStart(2, "0")}` : "");

async function Rapports({ pg }: { pg: Pg }) {
  const nb = await prisma.rapport.count();
  const fen = fenetrePage(nb, pg.page, pg.par, PLAFOND_TOUT);
  const rapports = await prisma.rapport.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: fen.skip, take: fen.take });
  if (nb === 0) return <EtatVide message="Aucun rapport généré. Utilisez le bouton « Rapport » dans les onglets concernés." />;
  const groupes = grouperParMois(rapports, (r) => r.createdAt);
  const periode = (r: (typeof rapports)[number]) =>
    `${r.periodeDebut ? new Date(r.periodeDebut).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"} → ${r.periodeFin ? new Date(r.periodeFin).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "—"}`;
  return (
    <div className="space-y-2">
      {groupes.map((g, i) => (
        <MoisAccordeon key={g.cle} titre={g.titre} compteur={compteurMois(g.items.length, groupePartiel(i, groupes.length, fen), "rapport(s)")} defaultOpen={i === 0}>
          <ul className="divide-y border-t text-sm">
            {g.items.map((r) => {
              const url = `/stock/rapports/export?type=${r.type}&mode=${r.mode}&format=${r.format}&debut=${moisISO(r.periodeDebut)}&fin=${moisISO(r.periodeFin)}`;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-accent/40">
                  <span className="min-w-0">
                    <span className="font-medium">{TYPE_RAPPORT_LABEL[r.type] ?? r.type}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{r.mode === "detail" ? "Détaillé" : "Chiffré"} · {r.format.toUpperCase()} · {periode(r)} · généré le {jfr(r.createdAt)}</span>
                  </span>
                  <TelechargerLien href={url} className="shrink-0 rounded border px-2.5 py-1 text-xs font-medium hover:bg-accent">Télécharger</TelechargerLien>
                </li>
              );
            })}
          </ul>
        </MoisAccordeon>
      ))}
      <BarrePages total={nb} pg={pg} page={fen.page} libelle="rapports" />
    </div>
  );
}

async function Journal({ entite, userId, pg }: { entite?: string; userId?: string; pg: Pg }) {
  const filtreEntite = entite && STOCK_ENTITES.includes(entite) ? entite : undefined;
  const filtreUser = userId || undefined;
  const where: Prisma.JournalAuditWhereInput = { entite: filtreEntite ? filtreEntite : { in: STOCK_ENTITES }, ...(filtreUser ? { userId: filtreUser } : {}) };
  // Le filtre (type, personne) porte sur TOUT le journal ; seule la tranche de la page est lue.
  const nb = await prisma.journalAudit.count({ where });
  const fen = fenetrePage(nb, pg.page, pg.par, PLAFOND_TOUT);

  const [entrees, users] = await Promise.all([
    prisma.journalAudit.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "asc" }],
      skip: fen.skip,
      take: fen.take,
      include: { user: { select: { nom: true } } },
    }),
    prisma.user.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);

  return (
    <div className="space-y-3">
      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="vue" value="journal" />
        {pg.par !== PAR_DEFAUT && <input type="hidden" name="par" value={pg.par} />}
        <select name="entite" defaultValue={filtreEntite ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les types</option>
          {STOCK_ENTITES.map((e) => <option key={e} value={e}>{ENTITE_LABEL[e] ?? e}</option>)}
        </select>
        <select name="userId" defaultValue={filtreUser ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Toutes les personnes</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.nom}</option>)}
        </select>
        <button className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        {(filtreEntite || filtreUser) && <Link href={`/stock/archives?vue=journal${pg.par !== PAR_DEFAUT ? `&par=${pg.par}` : ""}`} className="text-muted-foreground underline">Réinitialiser</Link>}
        <span className="text-xs text-muted-foreground">{nb} entrée(s)</span>
      </form>

      {nb === 0 ? (
        <EtatVide message="Aucune activité enregistrée." />
      ) : (
        <div className="space-y-2">
          {(() => { const groupes = grouperParMois(entrees, (e) => e.date); return groupes.map((g, i) => (
            <MoisAccordeon key={g.cle} titre={g.titre} compteur={compteurMois(g.items.length, groupePartiel(i, groupes.length, fen), "entrée(s)")} defaultOpen={i === 0}>
              <ul className="divide-y border-t text-sm">
                {g.items.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="font-medium">{ENTITE_LABEL[e.entite] ?? e.entite}</span> <span className="text-xs text-muted-foreground">· {e.champ}</span>
                      <span className="block truncate text-xs text-muted-foreground">{e.nouvelleValeur ?? e.ancienneValeur ?? "—"}{e.user?.nom ? ` · ${e.user.nom}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(e.date).toLocaleString("fr-FR", { timeZone: "Africa/Kinshasa" })}</span>
                  </li>
                ))}
              </ul>
            </MoisAccordeon>
          )); })()}
          <BarrePages total={nb} pg={pg} page={fen.page} libelle="entrées" />
        </div>
      )}
    </div>
  );
}
