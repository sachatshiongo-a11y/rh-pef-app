import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { Avatar } from "@/components/avatar";
import { niveauAlerte, ALERTE_CLASSE, usd, qte, STATUT_BC_LABEL, STATUT_BC_CLASSE, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";

const jfr = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");

export default async function StockDashboard() {
  const user = await verifySession();
  const prenom = user.nom.split(" ")[0];
  const now = new Date();
  const annee = now.getFullYear(), mois = now.getMonth() + 1;
  const dateDuJour = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const [
    moi, config, nbArticles, nbFournisseurs, stocks, facturesDues,
    bcBrouillons, derniersBC, dernieresFactures, mouvementsRecents, reconRecentes,
    commandesMois, topArticles, fournTop, fournisseursListe,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
    prisma.articleStock.count(),
    prisma.fournisseur.count(),
    prisma.stock.findMany({ include: { article: { select: { designation: true, prixUnitaireUSD: true } } } }),
    prisma.factureFournisseur.aggregate({ where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } }, _sum: { resteAPayerUSD: true }, _count: true }),
    prisma.bonDeCommande.findMany({ where: { statut: "BROUILLON" }, orderBy: { createdAt: "desc" }, take: 5, include: { fournisseur: { select: { nom: true } } } }),
    prisma.bonDeCommande.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { fournisseur: { select: { nom: true } } } }),
    prisma.mouvementStock.findMany({ where: { type: { in: ["ENTREE", "SORTIE"] } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8, include: { article: { select: { designation: true } } } }),
    prisma.mouvementStock.findMany({ where: { type: "AJUSTEMENT" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 5, include: { article: { select: { designation: true } } } }),
    prisma.bonDeCommande.count({ where: { annee, mois } }),
    prisma.ligneBonDeCommande.groupBy({ by: ["designation"], _count: { designation: true }, _sum: { quantite: true }, orderBy: { _count: { designation: "desc" } }, take: 8 }),
    prisma.bonDeCommande.groupBy({ by: ["fournisseurId"], _count: { fournisseurId: true }, orderBy: { _count: { fournisseurId: "desc" } }, take: 5 }),
    prisma.fournisseur.findMany({ select: { id: true, nom: true } }),
  ]);

  const maPhoto = moi?.employe?.photoUrl ?? null;
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  const avecAlerte = stocks.map((s) => ({
    designation: s.article.designation,
    quantite: s.quantite,
    niveau: niveauAlerte(s.quantite, s.seuilUrgent, s.stockMinimum),
    valeur: s.article.prixUnitaireUSD ? Number(s.quantite) * Number(s.article.prixUnitaireUSD) : 0,
  }));
  const nbUrgent = avecAlerte.filter((a) => a.niveau === "URGENT").length;
  const nbAppro = avecAlerte.filter((a) => a.niveau === "APPRO").length;
  const valeurStock = avecAlerte.reduce((t, a) => t + a.valeur, 0);
  const auSeuil = avecAlerte.filter((a) => a.niveau === "URGENT" || a.niveau === "APPRO")
    .sort((a, b) => (a.niveau === "URGENT" ? 0 : 1) - (b.niveau === "URGENT" ? 0 : 1)).slice(0, 8);

  const fournNom = new Map(fournisseursListe.map((f) => [f.id, f.nom]));
  const topFourn = fournTop.filter((f) => f.fournisseurId).map((f) => ({ nom: fournNom.get(f.fournisseurId!) ?? "—", n: f._count.fournisseurId }));

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <Avatar nom={user.nom} taille={56} photoUrl={maPhoto} />
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">Bonjour {prenom}</h1>
            <p className="text-sm capitalize text-muted-foreground">{user.role === "ADMIN" ? "Direction" : "Responsable stock"} · {dateDuJour} · Stock &amp; Achats</p>
          </div>
        </div>
        <div className="rounded-xl border bg-muted/30 px-4 py-2 text-right">
          <p className="text-xs text-muted-foreground">Taux du jour</p>
          <p className="text-lg font-semibold">1 USD = {taux ? taux.toLocaleString("fr-FR") : "—"} CDF</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Articles" valeur={String(nbArticles)} href="/stock/catalogue/nourriture" />
        <Kpi label="Alertes urgentes" valeur={String(nbUrgent)} accent={nbUrgent > 0 ? "red" : undefined} />
        <Kpi label="À réapprovisionner" valeur={String(nbAppro)} accent={nbAppro > 0 ? "amber" : undefined} />
        <Kpi label="Valeur du stock" valeur={usd(valeurStock)} />
        <Kpi label="Factures à payer" valeur={usd(facturesDues._sum.resteAPayerUSD)} sous={`${facturesDues._count} facture(s)`} accent={Number(facturesDues._sum.resteAPayerUSD ?? 0) > 0 ? "amber" : undefined} href="/stock/factures?statut=du" />
        <Kpi label="Commandes du mois" valeur={String(commandesMois)} href="/stock/commandes" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Bloc titre={`Articles au seuil minimum (${nbUrgent + nbAppro})`} lien="/stock/catalogue/nourriture">
          {auSeuil.length === 0 ? <Vide t="Aucun article sous le seuil." /> : (
            <ul className="divide-y text-sm">
              {auSeuil.map((a, i) => (
                <li key={i} className="flex items-center justify-between py-1.5">
                  <span className="truncate pr-2">{a.designation}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[a.niveau]}`}>{qte(a.quantite)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre={`Demandes de validation de BC (${bcBrouillons.length})`} lien="/stock/a-valider">
          {bcBrouillons.length === 0 ? <Vide t="Aucun bon de commande à valider." /> : (
            <ul className="divide-y text-sm">
              {bcBrouillons.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-1.5">
                  <Link href={`/stock/commandes/${b.id}`} className="truncate pr-2 hover:underline">{b.numero} · {b.fournisseur?.nom ?? "—"}</Link>
                  <span className="shrink-0 font-medium">{usd(b.totalUSD)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Derniers bons de commande" lien="/stock/commandes">
          {derniersBC.length === 0 ? <Vide t="Aucun bon de commande." /> : (
            <ul className="divide-y text-sm">
              {derniersBC.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/stock/commandes/${b.id}`} className="truncate hover:underline">{b.numero} · {b.fournisseur?.nom ?? "—"}</Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Dernières factures" lien="/stock/factures">
          {dernieresFactures.length === 0 ? <Vide t="Aucune facture." /> : (
            <ul className="divide-y text-sm">
              {dernieresFactures.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/stock/factures/${f.id}`} className="truncate hover:underline">{f.fournisseur?.nom ?? f.fournisseurNom} · {usd(f.montantUSD)}</Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Dernières entrées & sorties" lien="/stock/mouvements">
          {mouvementsRecents.length === 0 ? <Vide t="Aucun mouvement." /> : (
            <ul className="divide-y text-sm">
              {mouvementsRecents.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{m.article.designation}<span className="text-xs text-muted-foreground"> · {jfr(m.date)}</span></span>
                  <span className={`shrink-0 font-medium ${m.type === "SORTIE" ? "text-red-700" : "text-emerald-700"}`}>{m.type === "SORTIE" ? "−" : "+"}{qte(m.quantite)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Réconciliations récentes (ajustements)" lien="/stock/reconciliation">
          {reconRecentes.length === 0 ? <Vide t="Aucun ajustement d'inventaire." /> : (
            <ul className="divide-y text-sm">
              {reconRecentes.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{m.article.designation}<span className="text-xs text-muted-foreground"> · {jfr(m.date)}</span></span>
                  <span className="shrink-0 text-muted-foreground">{qte(m.quantite)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Articles les plus commandés" lien="/stock/commandes">
          {topArticles.length === 0 ? <Vide t="Aucune commande enregistrée." /> : (
            <ul className="divide-y text-sm">
              {topArticles.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{a.designation}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a._count.designation} commande(s) · {qte(a._sum.quantite ?? 0)} au total</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Fournisseurs les plus sollicités" lien="/stock/fournisseurs">
          {topFourn.length === 0 ? <Vide t="Aucun bon de commande." /> : (
            <ul className="divide-y text-sm">
              {topFourn.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{i === 0 && <span className="mr-1">🏆</span>}{f.nom}</span>
                  <span className="shrink-0 font-medium">{f.n} BC</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      </div>

      <p className="text-xs text-muted-foreground">{nbFournisseurs} fournisseurs · {nbArticles} articles au catalogue.</p>
    </div>
  );
}

function Kpi({ label, valeur, sous, accent, href }: { label: string; valeur: string; sous?: string; accent?: "red" | "amber"; href?: string }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : "";
  const inner = (
    <div className={`rounded-lg border p-4 ${cls} ${href ? "transition-colors hover:border-primary" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{valeur}</p>
      {sous && <p className="text-xs text-muted-foreground">{sous}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Bloc({ titre, lien, children }: { titre: string; lien: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{titre}</h2>
        <Link href={lien} className="text-xs text-primary underline">Tout voir</Link>
      </div>
      {children}
    </div>
  );
}

function Vide({ t }: { t: string }) {
  return <p className="text-sm text-muted-foreground">{t}</p>;
}
