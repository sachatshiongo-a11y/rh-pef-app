import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { usd, qte, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";
import { verifySession } from "@/lib/auth";
import { MarquerPayeeBtn } from "./marquer-payee-btn";
import { JoindreDocument } from "./joindre-document";
import { LierBon } from "./lier-bon";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");
const cle = (articleId: string | null, designation: string) => articleId ?? `#${designation.trim().toLowerCase()}`;

export default async function FactureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
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

  // Bons de commande liables (même fournisseur), pour lier / changer à tout moment.
  const bonsLiablesRaw = await prisma.bonDeCommande.findMany({
    where: { statut: { not: "ANNULE" }, ...(facture.fournisseurId ? { fournisseurId: facture.fournisseurId } : {}) },
    orderBy: [{ annee: "desc" }, { sequence: "desc" }],
    take: 100,
    select: { id: true, numero: true, totalUSD: true },
  });
  const bonsLiables = bonsLiablesRaw.map((b) => ({ id: b.id, numero: b.numero, total: Number(b.totalUSD) }));

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
  // L'écart à SIGNALER porte sur les QUANTITÉS (commandé vs livré/facturé), pas sur le montant :
  // une différence de prix ne change pas ce qu'il y a à payer (= le montant de la facture).
  const lignesEcartQte = lignesRecon.filter((l) => Math.abs(l.qteFac - l.qteBC) > 0.0001);
  const ecartQteTotal = lignesRecon.reduce((t, l) => t + Math.abs(l.qteFac - l.qteBC), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Facture · {facture.fournisseurId
          ? <Link href={`/stock/fournisseurs/${facture.fournisseurId}`} className="text-primary hover:underline">{nom}</Link>
          : nom}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {facture.statut !== "REGLEE" && <MarquerPayeeBtn id={facture.id} />}
          <Link href="/stock/factures" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">← Retour</Link>
        </div>
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

      {/* Document d'origine (PDF ou scan joint) */}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3">
        <span className="text-sm font-medium">Document d’origine</span>
        {facture.documentUrl
          ? <a href={facture.documentUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">📄 Voir le document</a>
          : <span className="text-sm text-muted-foreground">Aucun document joint.</span>}
        {estDirection && <JoindreDocument id={facture.id} aDeja={!!facture.documentUrl} />}
      </section>

      {/* Lignes de la facture */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Articles facturés</h2>
        <div className="max-h-[70vh] overflow-auto rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-left">
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
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
          <span className="text-sm font-medium">Bon de commande lié :</span>
          <LierBon factureId={facture.id} bonActuelId={facture.bonDeCommandeId} bons={bonsLiables} />
        </div>
        {!bc ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun bon de commande lié pour l’instant. Choisissez-en un ci-dessus pour comparer commandé et facturé.</p>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto rounded-lg border">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left">
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
                        <td className="px-3 py-2 text-right text-muted-foreground">{Math.abs(eTot) > 0.009 ? `${eTot > 0 ? "+" : ""}${usd(eTot)}` : "0"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-semibold [&>td]:px-3 [&>td]:py-2">
                    <td colSpan={4}>Totaux</td>
                    <td className="text-right">{usd(totBC)}</td>
                    <td className="text-right">{usd(totFac)}</td>
                    <td className="text-right text-muted-foreground">{ecartTotal >= 0 ? "+" : ""}{usd(ecartTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {lignesEcartQte.length === 0
              ? <p className="text-xs text-emerald-700">✓ Quantités conformes au bon de commande.</p>
              : (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-medium">⚠ Écart de quantités sur {lignesEcartQte.length} article(s) (total {qte(ecartQteTotal)}) :</p>
                  <ul className="mt-1 list-disc pl-4">
                    {lignesEcartQte.map((l, i) => {
                      const e = l.qteFac - l.qteBC;
                      return <li key={i}>{l.designation} : commandé {qte(l.qteBC)}, facturé {qte(l.qteFac)} ({e > 0 ? "+" : ""}{qte(e)})</li>;
                    })}
                  </ul>
                  <p className="mt-1 text-[11px]">Une différence de montant n’affecte pas la somme à payer : c’est le montant de la facture qui fait foi.</p>
                </div>
              )}
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
