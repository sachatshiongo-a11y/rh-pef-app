import Link from "next/link";
import { FilAriane } from "@/components/fil-ariane";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { niveauAlerte, ALERTE_LABEL, DOMAINE_LABEL, usd, qte, type NiveauAlerte } from "@/lib/stock";

const dCourt = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "—");
const segDomaine = (dom: string) => (dom === "NOURRITURE" ? "nourriture" : dom === "BOISSON" ? "boissons" : "autre");

export default async function ArticleFichePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await verifySession();

  const a = await prisma.articleStock.findUnique({
    where: { id },
    include: {
      stock: true,
      categorie: { select: { nom: true } },
      fournisseur: { select: { id: true, nom: true } },
      mouvements: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: {
          facture: { select: { id: true, numero: true, fournisseurId: true, fournisseurNom: true } },
          reception: { select: { bonDeCommande: { select: { id: true, numero: true, fournisseurId: true, fournisseur: { select: { nom: true } } } } } },
        },
      },
      lignesFacture: {
        include: { facture: { select: { id: true, numero: true, date: true } } },
      },
    },
  });
  if (!a) notFound();

  const niv: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
  const stockQte = a.stock ? Number(a.stock.quantite) : 0;
  const valeur = stockQte * (Number(a.prixUnitaireUSD) || 0);

  // Évolution du prix : chaque ligne de facture porte un prix unitaire figé + la date de la facture.
  const prixHisto = a.lignesFacture
    .filter((l) => l.facture.date)
    .map((l) => ({ date: l.facture.date as Date, prix: Number(l.prixUnitaireUSD), qte: Number(l.quantite), factureId: l.facture.id, numero: l.facture.numero }))
    .sort((x, y) => x.date.getTime() - y.date.getTime());
  const prixVals = prixHisto.map((p) => p.prix);
  const prixMin = prixVals.length ? Math.min(...prixVals) : null;
  const prixMax = prixVals.length ? Math.max(...prixVals) : null;
  const dernier = prixHisto.at(-1) ?? null;
  const avant = prixHisto.length >= 2 ? prixHisto.at(-2)! : null;
  const variation = dernier && avant && avant.prix > 0 ? ((dernier.prix - avant.prix) / avant.prix) * 100 : null;

  const source = (m: (typeof a.mouvements)[number]) => {
    const bc = m.reception?.bonDeCommande;
    const fournId = m.facture?.fournisseurId ?? bc?.fournisseurId ?? null;
    const fournNom = m.facture?.fournisseurNom ?? bc?.fournisseur?.nom ?? null;
    return { facture: m.facture, bc, fournId, fournNom };
  };

  return (
    <div className="max-w-4xl space-y-5">
      <FilAriane segments={[{ label: "Catalogue", href: `/stock/catalogue/${segDomaine(a.domaine)}` }, { label: a.designation }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{a.designation}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{DOMAINE_LABEL[a.domaine] ?? a.domaine}</span>
            <span>· {a.categorie?.nom ?? "à classer"}</span>
            {a.code && <span>· Code {a.code}</span>}
            {a.unite && <span>· {a.unite}</span>}
            {a.fournisseur && <span>· <Link href={`/stock/fournisseurs/${a.fournisseur.id}`} className="text-primary hover:underline">{a.fournisseur.nom}</Link></span>}
          </p>
        </div>
        <Link href={`/stock/catalogue/${segDomaine(a.domaine)}?q=${encodeURIComponent(a.designation)}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
          Éditer dans le catalogue
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Stock actuel" valeur={a.stock ? `${qte(a.stock.quantite)}${a.unite ? ` ${a.unite}` : ""}` : "—"} accent={stockQte < 0 ? "red" : undefined} />
        <Kpi label="Valeur du stock" valeur={usd(valeur)} />
        <Kpi label="Prix de référence" valeur={usd(a.prixUnitaireUSD)} />
        <Kpi label="Alerte" valeur={niv ? ALERTE_LABEL[niv] : "—"} accent={niv === "URGENT" ? "red" : niv === "APPRO" ? "amber" : niv === "OK" ? "green" : undefined} />
      </div>

      {a.stock && (
        <p className="text-xs text-muted-foreground">
          Seuil minimum : <span className="font-medium">{qte(a.stock.stockMinimum)}</span>
          {Number(a.stock.seuilUrgent) > 0 && <> · seuil urgent : <span className="font-medium">{qte(a.stock.seuilUrgent)}</span></>}
        </p>
      )}

      {/* Évolution du prix d'achat (lignes de facture) */}
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Évolution du prix d&apos;achat</h2>
          {prixHisto.length > 0 && (
            <span className="text-xs text-muted-foreground">
              min {usd(prixMin)} · max {usd(prixMax)}
              {variation !== null && (
                <span className={`ml-2 font-medium ${variation > 0 ? "text-red-700" : variation < 0 ? "text-emerald-700" : ""}`}>
                  {variation > 0 ? "▲" : variation < 0 ? "▼" : ""} {Math.abs(variation).toFixed(1)}% vs achat précédent
                </span>
              )}
            </span>
          )}
        </div>
        {prixHisto.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun achat facturé pour cet article. Le prix évoluera au fil des factures.</p>
        ) : (
          <>
            <Sparkline points={prixHisto.map((p) => p.prix)} />
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-1 font-medium">Date</th><th className="py-1 font-medium">Facture</th><th className="py-1 text-right font-medium">Qté</th><th className="py-1 text-right font-medium">Prix unit.</th></tr>
                </thead>
                <tbody>
                  {[...prixHisto].reverse().map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5">{dCourt(p.date)}</td>
                      <td className="py-1.5"><Link href={`/stock/factures/${p.factureId}`} className="text-primary hover:underline">{p.numero ?? "Facture"}</Link></td>
                      <td className="py-1.5 text-right tabular-nums">{qte(p.qte)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{usd(p.prix)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Historique des mouvements */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Mouvements ({a.mouvements.length})</h2>
        {a.mouvements.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun mouvement de stock pour cet article.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <div className="max-h-[70vh] divide-y overflow-auto">
              {a.mouvements.map((m) => {
                const sortie = m.type === "SORTIE";
                const src = source(m);
                const chip = "rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20";
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium capitalize">{new Date(m.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" })}</div>
                      {m.origine && <div className="truncate text-[11px] text-muted-foreground">{m.origine}</div>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {src.facture && <Link href={`/stock/factures/${src.facture.id}`} className={chip}>🧾 Facture{src.facture.numero ? ` ${src.facture.numero}` : ""}</Link>}
                        {src.bc && <Link href={`/stock/commandes/${src.bc.id}`} className={chip}>📄 BC {src.bc.numero}</Link>}
                        {src.fournId && <Link href={`/stock/fournisseurs/${src.fournId}`} className={chip}>🏢 {src.fournNom ?? "Fournisseur"}</Link>}
                        {sortie && m.categorieSortie && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{m.categorieSortie === "PERTE" ? "Perte" : "Livraison restaurant"}</span>}
                      </div>
                    </div>
                    <div className={`shrink-0 text-right font-semibold tabular-nums ${sortie ? "text-red-700" : "text-emerald-700"}`}>
                      {sortie ? "−" : "+"}{qte(m.quantite)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
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

// Mini-courbe SVG de l'évolution du prix (sans dépendance). Chronologique, gauche → droite.
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="text-xs text-muted-foreground">Un seul achat — pas encore de courbe.</p>;
  const w = 600, h = 60, pad = 4;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" role="img" aria-label="Évolution du prix">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" vectorEffect="non-scaling-stroke" />
      {points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className="fill-primary" />)}
    </svg>
  );
}
