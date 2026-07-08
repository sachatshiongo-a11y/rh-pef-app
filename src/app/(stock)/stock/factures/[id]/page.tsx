import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { usd, qte, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");
const cle = (articleId: string | null, designation: string) => articleId ?? `#${designation.trim().toLowerCase()}`;

export default async function FactureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facture = await prisma.factureFournisseur.findUnique({
    where: { id },
    include: {
      fournisseur: { select: { nom: true } },
      lignes: { orderBy: { designation: "asc" } },
      bonDeCommande: { select: { id: true, numero: true, totalUSD: true, lignes: { orderBy: { designation: "asc" } } } },
    },
  });
  if (!facture) notFound();

  const nom = facture.fournisseur?.nom ?? facture.fournisseurNom;
  const bc = facture.bonDeCommande;

  // Réconciliation : croise les lignes du BC (commandé) et de la facture (facturé).
  type L = { designation: string; qteBC: number; puBC: number; totBC: number; qteFac: number; puFac: number; totFac: number };
  const recon = new Map<string, L>();
  if (bc) for (const l of bc.lignes) {
    const k = cle(l.articleId, l.designation);
    const e = recon.get(k) ?? { designation: l.designation, qteBC: 0, puBC: 0, totBC: 0, qteFac: 0, puFac: 0, totFac: 0 };
    e.qteBC += Number(l.quantite); e.puBC = Number(l.prixUnitaireUSD); e.totBC += Number(l.totalLigneUSD);
    recon.set(k, e);
  }
  for (const l of facture.lignes) {
    const k = cle(l.articleId, l.designation);
    const e = recon.get(k) ?? { designation: l.designation, qteBC: 0, puBC: 0, totBC: 0, qteFac: 0, puFac: 0, totFac: 0 };
    e.qteFac += Number(l.quantite); e.puFac = Number(l.prixUnitaireUSD); e.totFac += Number(l.totalLigneUSD);
    recon.set(k, e);
  }
  const lignesRecon = [...recon.values()];
  const totBC = bc ? Number(bc.totalUSD) : 0;
  const totFac = Number(facture.montantUSD);
  const ecartTotal = totFac - totBC;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Facture · {nom}</h1>
        <Link href="/stock/factures" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">← Retour</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <Info label="N° facture" val={facture.numero ?? "—"} />
        <Info label="Date" val={d(facture.date)} />
        <Info label="Échéance" val={d(facture.dateEcheance)} />
        <div>
          <p className="text-xs text-muted-foreground">Statut</p>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[facture.statut]}`}>{STATUT_FACTURE_LABEL[facture.statut]}</span>
        </div>
        <Info label="Montant" val={usd(facture.montantUSD)} />
        <Info label="Réglé" val={usd(Number(facture.montantRegleUSD))} />
        <Info label="Reste à payer" val={usd(Number(facture.resteAPayerUSD))} accent={Number(facture.resteAPayerUSD) > 0} />
        <Info label="Mode de paiement" val={facture.modePaiement ?? "—"} />
      </div>

      {/* Lignes de la facture */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Articles facturés</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr className="[&>th]:px-3 [&>th]:py-2">
                <th>Article</th><th>Unité</th><th className="text-right">Quantité</th><th className="text-right">P.U.</th><th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {facture.lignes.map((l) => (
                <tr key={l.id} className="border-t even:bg-muted/25">
                  <td className="px-3 py-2 font-medium">{l.designation}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.unite ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{qte(l.quantite)}</td>
                  <td className="px-3 py-2 text-right">{usd(l.prixUnitaireUSD)}</td>
                  <td className="px-3 py-2 text-right">{usd(l.totalLigneUSD)}</td>
                </tr>
              ))}
              {facture.lignes.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Cette facture n’a pas de lignes détaillées.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Réconciliation avec le bon de commande */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Réconciliation bon de commande ↔ facture</h2>
          {bc && <Link href={`/stock/commandes/${bc.id}`} className="text-xs text-primary hover:underline">Voir le BC {bc.numero}</Link>}
        </div>
        {!bc ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun bon de commande lié à cette facture. Liez-en un depuis le formulaire de facture pour comparer commandé et facturé.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="[&>th]:px-3 [&>th]:py-2">
                    <th>Article</th>
                    <th className="text-right">Qté cmd</th>
                    <th className="text-right">Qté fact</th>
                    <th className="text-right">Écart qté</th>
                    <th className="text-right">Total cmd</th>
                    <th className="text-right">Total fact</th>
                    <th className="text-right">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesRecon.map((l, i) => {
                    const eQte = l.qteFac - l.qteBC;
                    const eTot = l.totFac - l.totBC;
                    return (
                      <tr key={i} className="border-t even:bg-muted/25">
                        <td className="px-3 py-2 font-medium">{l.designation}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{l.qteBC ? qte(l.qteBC) : "—"}</td>
                        <td className="px-3 py-2 text-right">{l.qteFac ? qte(l.qteFac) : "—"}</td>
                        <td className={`px-3 py-2 text-right ${eQte ? "font-medium text-amber-700" : "text-muted-foreground"}`}>{eQte ? `${eQte > 0 ? "+" : ""}${qte(eQte)}` : "0"}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{l.totBC ? usd(l.totBC) : "—"}</td>
                        <td className="px-3 py-2 text-right">{l.totFac ? usd(l.totFac) : "—"}</td>
                        <td className={`px-3 py-2 text-right ${Math.abs(eTot) > 0.009 ? "font-medium text-amber-700" : "text-muted-foreground"}`}>{Math.abs(eTot) > 0.009 ? `${eTot > 0 ? "+" : ""}${usd(eTot)}` : "0"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-semibold [&>td]:px-3 [&>td]:py-2">
                    <td colSpan={4}>Totaux</td>
                    <td className="text-right">{usd(totBC)}</td>
                    <td className="text-right">{usd(totFac)}</td>
                    <td className={`text-right ${Math.abs(ecartTotal) > 0.009 ? "text-amber-700" : ""}`}>{ecartTotal >= 0 ? "+" : ""}{usd(ecartTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {Math.abs(ecartTotal) <= 0.009
              ? <p className="text-xs text-emerald-700">✓ Facture conforme au bon de commande.</p>
              : <p className="text-xs text-amber-700">⚠ Écart de {usd(Math.abs(ecartTotal))} entre le commandé et le facturé.</p>}
          </>
        )}
      </section>
    </div>
  );
}

function Info({ label, val, accent }: { label: string; val: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-medium ${accent ? "text-red-700" : ""}`}>{val}</p>
    </div>
  );
}
