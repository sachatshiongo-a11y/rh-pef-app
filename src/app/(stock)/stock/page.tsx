import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_CLASSE, usd, qte } from "@/lib/stock";

export default async function StockDashboard() {
  const [nbArticles, nbFournisseurs, stocks, facturesDues, echues] = await Promise.all([
    prisma.articleStock.count(),
    prisma.fournisseur.count(),
    prisma.stock.findMany({
      include: { article: { select: { designation: true, prixUnitaireUSD: true } } },
    }),
    prisma.factureFournisseur.aggregate({
      where: { statut: { in: ["A_REGLER", "ECHUE_NON_REGLEE"] } },
      _sum: { resteAPayerUSD: true },
      _count: true,
    }),
    prisma.factureFournisseur.findMany({
      where: { statut: "ECHUE_NON_REGLEE" },
      orderBy: { dateEcheance: "asc" },
      take: 6,
    }),
  ]);

  const avecAlerte = stocks.map((s) => ({
    designation: s.article.designation,
    quantite: s.quantite,
    niveau: niveauAlerte(s.quantite, s.seuilUrgent, s.stockMinimum),
    valeur: s.article.prixUnitaireUSD ? Number(s.quantite) * Number(s.article.prixUnitaireUSD) : 0,
  }));
  const nbUrgent = avecAlerte.filter((a) => a.niveau === "URGENT").length;
  const nbAppro = avecAlerte.filter((a) => a.niveau === "APPRO").length;
  const valeurStock = avecAlerte.reduce((t, a) => t + a.valeur, 0);
  const urgents = avecAlerte.filter((a) => a.niveau === "URGENT").slice(0, 8);

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-xl font-semibold sm:text-2xl">Tableau de bord — Stock &amp; Achats</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Articles" valeur={String(nbArticles)} href="/stock/catalogue" />
        <Kpi label="Alertes urgentes" valeur={String(nbUrgent)} accent={nbUrgent > 0 ? "red" : undefined} href="/stock/catalogue?alerte=URGENT" />
        <Kpi label="À réapprovisionner" valeur={String(nbAppro)} accent={nbAppro > 0 ? "amber" : undefined} href="/stock/catalogue?alerte=APPRO" />
        <Kpi label="Valeur du stock" valeur={usd(valeurStock)} />
        <Kpi label="Factures à payer" valeur={usd(facturesDues._sum.resteAPayerUSD)} sous={`${facturesDues._count} facture(s)`} accent={Number(facturesDues._sum.resteAPayerUSD ?? 0) > 0 ? "amber" : undefined} href="/stock/factures?statut=du" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Bloc titre={`Stock urgent (${nbUrgent})`} lien="/stock/catalogue?alerte=URGENT">
          {urgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun article en rupture.</p>
          ) : (
            <ul className="divide-y text-sm">
              {urgents.map((a, i) => (
                <li key={i} className="flex items-center justify-between py-1.5">
                  <span className="truncate pr-2">{a.designation}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[a.niveau]}`}>
                    {qte(a.quantite)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Factures échues non réglées" lien="/stock/factures?statut=du">
          {echues.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune facture échue.</p>
          ) : (
            <ul className="divide-y text-sm">
              {echues.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-1.5">
                  <span className="truncate pr-2">
                    {f.fournisseurNom}
                    {f.dateEcheance && <span className="text-xs text-muted-foreground"> · échéance {new Date(f.dateEcheance).toLocaleDateString("fr-FR")}</span>}
                  </span>
                  <span className="shrink-0 font-medium text-red-700">{usd(f.resteAPayerUSD)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      </div>

      <p className="text-xs text-muted-foreground">
        {nbFournisseurs} fournisseurs. Les seuils d&apos;alerte sont modifiables par article. Les
        écrans de bons de commande et de réception arrivent prochainement.
      </p>
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
