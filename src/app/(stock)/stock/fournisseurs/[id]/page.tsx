import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_CLASSE, ALERTE_LABEL, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE, STATUT_BC_LABEL, STATUT_BC_CLASSE, usd, qte, type NiveauAlerte } from "@/lib/stock";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");

export default async function FournisseurDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [f, factures, bons] = await Promise.all([
    prisma.fournisseur.findUnique({
      where: { id },
      include: {
        articles: { orderBy: { designation: "asc" }, include: { stock: true, categorie: { select: { nom: true } } } },
        _count: { select: { articles: true, factures: true, bonsCommande: true } },
      },
    }),
    prisma.factureFournisseur.findMany({ where: { fournisseurId: id }, orderBy: [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }], take: 500 }),
    prisma.bonDeCommande.findMany({ where: { fournisseurId: id }, orderBy: [{ annee: "desc" }, { date: "desc" }], take: 300, include: { _count: { select: { lignes: true } } } }),
  ]);
  if (!f) notFound();

  // Agrégats factures.
  let total = 0, regle = 0, impaye = 0, echu = 0, nbARegler = 0, nbEchu = 0;
  for (const x of factures) {
    const m = Number(x.montantUSD), r = Number(x.resteAPayerUSD);
    total += m;
    regle += m - r;
    if (x.statut !== "REGLEE") { impaye += r; nbARegler++; }
    if (x.statut === "ECHUE_NON_REGLEE") { echu += r; nbEchu++; }
  }
  const bonsValides = bons.filter((b) => b.statut !== "BROUILLON" && b.statut !== "ANNULE");

  const coord: [string, string | null][] = [
    ["Contact", f.contactNom], ["Téléphone", f.telephone], ["E-mail", f.email], ["Ville", f.ville],
    ["Pays", f.pays], ["RCCM", f.rccm], ["ID National", f.idNational],
    ["Délai de paiement", f.delaiPaiement], ["Délai de livraison", f.delaiLivraison],
    ["Mode de paiement", f.modePaiement], ["Produits fournis", f.produits],
  ];

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/stock/fournisseurs" className="underline">Fournisseurs</Link>
        <span>/</span>
        <span className="text-foreground">{f.nom}</span>
      </div>

      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{f.nom}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {f._count.articles} article(s) · {bonsValides.length} bon(s) de commande validé(s) · {factures.length} facture(s)
        </p>
      </div>

      {/* KPIs factures */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total facturé" valeur={usd(total)} />
        <Kpi label="Réglé" valeur={usd(regle)} accent="green" />
        <Kpi label={`Impayé (${nbARegler})`} valeur={usd(impaye)} accent={impaye > 0 ? "amber" : undefined} />
        <Kpi label={`Échu (${nbEchu})`} valeur={usd(echu)} accent={echu > 0 ? "red" : undefined} />
      </div>

      {/* Coordonnées */}
      <section className="rounded-xl border p-4">
        <h2 className="mb-3 text-base font-semibold">Coordonnées</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {coord.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed py-1 last:border-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
          {coord.every(([, v]) => !v) && <p className="text-sm text-muted-foreground">Aucune coordonnée renseignée.</p>}
        </dl>
      </section>

      {/* Bons de commande */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Bons de commande ({bons.length})</h2>
        {bons.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun bon de commande.</p>
        ) : (
          <div className="space-y-2">
            {bons.map((b) => (
              <Link key={b.id} href={`/stock/commandes/${b.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="font-medium">{b.numero}</div>
                  <div className="text-xs text-muted-foreground">{d(b.date)} · {b._count.lignes} ligne(s)</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span>
                  <span className="font-semibold tabular-nums">{usd(b.totalUSD)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Factures */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Factures ({factures.length})</h2>
        {factures.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucune facture.</p>
        ) : (
          <div className="space-y-2">
            {factures.map((x) => (
              <Link key={x.id} href={`/stock/factures/${x.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3 hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="font-medium">{x.numero ? `N° ${x.numero}` : "Sans N°"}</div>
                  <div className="text-xs text-muted-foreground">{d(x.date)} · échéance {d(x.dateEcheance)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[x.statut]}`}>{STATUT_FACTURE_LABEL[x.statut]}</span>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{usd(x.montantUSD)}</div>
                    {Number(x.resteAPayerUSD) > 0 && <div className="text-[11px] text-red-700">reste {usd(x.resteAPayerUSD)}</div>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Articles */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Articles fournis ({f.articles.length})</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Désignation</th>
                <th className="px-3 py-2">Catégorie</th>
                <th className="px-3 py-2 text-right">Prix USD</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2">Alerte</th>
              </tr>
            </thead>
            <tbody>
              {f.articles.map((a) => {
                const niv: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.seuilUrgent, a.stock.stockMinimum) : null;
                return (
                  <tr key={a.id} className="border-t hover:bg-accent/40 even:bg-muted/25">
                    <td className="px-3 py-2 font-medium">{a.designation}</td>
                    <td className="px-3 py-2 text-muted-foreground">{a.categorie?.nom ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{usd(a.prixUnitaireUSD)}</td>
                    <td className="px-3 py-2 text-right">{a.stock ? qte(a.stock.quantite) : "—"}</td>
                    <td className="px-3 py-2">{niv && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[niv]}`}>{ALERTE_LABEL[niv]}</span>}</td>
                  </tr>
                );
              })}
              {f.articles.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucun article rattaché. Rattachez-en depuis le catalogue.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, valeur, accent }: { label: string; valeur: string; accent?: "green" | "amber" | "red" }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : accent === "green" ? "border-emerald-200 bg-emerald-50" : "";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{valeur}</p>
    </div>
  );
}
