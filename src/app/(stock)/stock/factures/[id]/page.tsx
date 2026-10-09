import Link from "next/link";
import { FilAriane } from "@/components/fil-ariane";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { usd, qte, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";
import { MarquerPayeeBtn } from "./marquer-payee-btn";
import { JoindreDocument } from "./joindre-document";
import { EnregistrerPaiement } from "./enregistrer-paiement";
import { LierBon } from "./lier-bon";
import { exigerPageStock } from "@/lib/garde-page";
import { ApercuDocumentBouton } from "@/components/apercu-document";
import { demandeSurCible } from "@/lib/validations-stock/apercu";
import { cleFacture } from "@/lib/validations-stock/charge";
import { DetailDemande, AlertesDemande } from "../../a-valider/detail-demande";
import { DecisionDemande } from "../../a-valider/decision-demande";
import { lireRetourFiche } from "@/lib/fiche-fournisseur";
import { formaterFC, formaterNombre } from "@/lib/montant";
import { formaterMontantFacture, libelleAutreDevise, montantsFacture } from "@/lib/facture-devise";
import { CHAMPS_CONTENANCE, libelleLigneArticle } from "@/lib/libelle-article";

const d = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");
const cle = (articleId: string | null, designation: string) => articleId ?? `#${designation.trim().toLowerCase()}`;

export default async function FactureDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ retour?: string }> }) {
  const user = await exigerPageStock();
  const { id } = await params;
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  const facture = await prisma.factureFournisseur.findUnique({
    where: { id },
    include: {
      fournisseur: { select: { nom: true } },
      // Contenance de l'article lié : libellé AFFICHÉ de la ligne (la désignation figée reste la clé du rapprochement).
      lignes: { orderBy: { designation: "asc" }, include: { article: { select: CHAMPS_CONTENANCE } } },
      bonDeCommande: { select: { id: true, numero: true, totalUSD: true, lignes: { orderBy: { designation: "asc" }, include: { article: { select: CHAMPS_CONTENANCE } } } } },
      paiements: { orderBy: [{ date: "desc" }, { createdAt: "desc" }] },
    },
  });
  if (!facture) notFound();

  const [config, demande] = await Promise.all([
    prisma.config.findUnique({ where: { id: "singleton" } }),
    demandeSurCible(cleFacture(facture.id)), // paiement en attente de la Direction ?
  ]);
  const tauxCDF = config ? Number(config.tauxChangeCDF) : 0;
  const nom = facture.fournisseur?.nom ?? facture.fournisseurNom;
  // Montants DANS LA DEVISE de la facture (2026-10-09) ; en francs, l'équivalent « ≈ » au taux du jour.
  const m = montantsFacture(facture);
  const enFC = m.devise === "CDF";
  const fm = (n: number | null) => (n === null ? "—" : enFC ? formaterMontantFacture(n, "CDF") : usd(n));
  const prixLigne = (l: { prixUnitaireUSD: unknown; prixUnitaireCDF: unknown }) => (enFC ? (l.prixUnitaireCDF === null ? "—" : formaterMontantFacture(Number(l.prixUnitaireCDF), "CDF")) : usd(l.prixUnitaireUSD as number));
  const totalLigne = (l: { totalLigneUSD: unknown; totalLigneCDF: unknown }) => Number(enFC ? l.totalLigneCDF : l.totalLigneUSD);
  const bc = facture.bonDeCommande;
  const retour = lireRetourFiche(sp.retour, facture.fournisseurId);

  // Bons de commande liables (même fournisseur), pour lier / changer à tout moment.
  const bonsLiablesRaw = await prisma.bonDeCommande.findMany({
    where: { statut: { not: "ANNULE" }, ...(facture.fournisseurId ? { fournisseurId: facture.fournisseurId } : {}) },
    orderBy: [{ annee: "desc" }, { sequence: "desc" }],
    take: 100,
    select: { id: true, numero: true, totalUSD: true },
  });
  const bonsLiables = bonsLiablesRaw.map((b) => ({ id: b.id, numero: b.numero, total: Number(b.totalUSD) }));

  // Réconciliation : croise les lignes du BC (commandé) et de la facture (facturé).
  type L = { designation: string; libelle: string; articleId: string | null; qteBC: number; puBC: number; totBC: number; qteFac: number; puFac: number; totFac: number };
  const recon = new Map<string, L>();
  if (bc) for (const l of bc.lignes) {
    const k = cle(l.articleId, l.designation);
    const e = recon.get(k) ?? { designation: l.designation, libelle: libelleLigneArticle(l), articleId: l.articleId ?? null, qteBC: 0, puBC: 0, totBC: 0, qteFac: 0, puFac: 0, totFac: 0 };
    e.qteBC += Number(l.quantite); e.puBC = Number(l.prixUnitaireUSD); e.totBC += Number(l.totalLigneUSD);
    recon.set(k, e);
  }
  for (const l of facture.lignes) {
    const k = cle(l.articleId, l.designation);
    const e = recon.get(k) ?? { designation: l.designation, libelle: libelleLigneArticle(l), articleId: l.articleId ?? null, qteBC: 0, puBC: 0, totBC: 0, qteFac: 0, puFac: 0, totFac: 0 };
    e.qteFac += Number(l.quantite); e.puFac = Number(enFC ? l.prixUnitaireCDF : l.prixUnitaireUSD); e.totFac += totalLigne(l);
    recon.set(k, e);
  }
  const lignesRecon = [...recon.values()];
  const totBC = bc ? Number(bc.totalUSD) : 0;
  const totFac = m.montant;
  const ecartTotal = totFac - totBC;
  // L'écart à SIGNALER porte sur les QUANTITÉS (commandé vs livré/facturé), pas sur le montant :
  // une différence de prix ne change pas ce qu'il y a à payer (= le montant de la facture).
  const lignesEcartQte = lignesRecon.filter((l) => Math.abs(l.qteFac - l.qteBC) > 0.0001);
  const ecartQteTotal = lignesRecon.reduce((t, l) => t + Math.abs(l.qteFac - l.qteBC), 0);

  return (
    <div className="w-full space-y-5">
      {/* Ouverte depuis la fiche d'un fournisseur : on y revient, sur le bon onglet (`?retour=` validé, jamais cru tel quel). */}
      <FilAriane segments={[...(retour
        ? [{ label: "Fournisseurs", href: "/stock/fournisseurs" }, { label: nom, href: retour }]
        : [{ label: "Factures", href: "/stock/factures" }]), { label: facture.numero ? `N° ${facture.numero}` : nom }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Facture · {facture.fournisseurId
          ? <Link href={`/stock/fournisseurs/${facture.fournisseurId}`} className="text-primary hover:underline">{nom}</Link>
          : nom}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Un paiement déjà demandé se DÉCIDE (bloc ci-dessous) : pas de second geste de paiement. */}
          {facture.statut !== "REGLEE" && !demande && <MarquerPayeeBtn id={facture.id} estDirection={estDirection} reste={m.reste} taux={tauxCDF} deviseFacture={m.devise} />}
          {!demande && <EnregistrerPaiement factureId={facture.id} reste={m.reste} taux={tauxCDF} estDirection={estDirection} deviseFacture={m.devise} />}
          <Link href={retour ?? "/stock/factures"} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">← Retour</Link>
        </div>
      </div>

      {demande && (
        <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
          <p className="text-sm font-semibold text-amber-900">Paiement demandé — en attente de la Direction</p>
          <p className="text-xs text-amber-900/80">{demande.resume} · demandé par {demande.auteurNom} le {new Date(demande.creeLe).toLocaleDateString("fr-FR", { timeZone: "Africa/Kinshasa" })}. Rien n&apos;est payé avant sa validation.</p>
          <AlertesDemande a={demande} />
          <DetailDemande a={demande} />
          <DecisionDemande id={demande.id} version={demande.version} estDirection={estDirection} estAuteur={demande.auteurId === user.id} dateProposee={demande.paiement?.date} />
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm sm:grid-cols-4">
        <Info label="N° facture" val={facture.numero ?? "—"} />
        <Info label="Date" val={d(facture.date)} />
        <Info label="Échéance" val={d(facture.dateEcheance)} />
        <div>
          <p className="text-xs text-muted-foreground">Statut</p>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[facture.statut]}`}>{STATUT_FACTURE_LABEL[facture.statut]}</span>
        </div>
        <Info label="Montant" val={fm(m.montant)} sous={enFC ? libelleAutreDevise(m.montant, "CDF", tauxCDF) + " au taux du jour" : undefined} />
        <Info label="Réglé" val={fm(m.regle)} />
        <Info label="Reste à payer" val={fm(m.reste)} accent={m.reste > 0} sous={enFC && m.reste > 0 ? libelleAutreDevise(m.reste, "CDF", tauxCDF) + " au taux du jour" : undefined} />
        <Info label="Mode de paiement" val={facture.modePaiement ?? "—"} />
        {enFC && (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-xs text-muted-foreground">
              Facture <b>en francs (FC)</b> : montant, réglé et reste tenus en francs, sans conversion.
              {facture.tauxChangeUtilise !== null ? <> Taux du jour à l&apos;enregistrement : {formaterNombre(Number(facture.tauxChangeUtilise))} FC/$ (valorise l&apos;entrée en stock en dollars).</> : null}
            </p>
          </div>
        )}
      </div>

      {/* Document d'origine (PDF ou scan joint) */}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3">
        <span className="text-sm font-medium">Document d’origine</span>
        {facture.documentUrl
          ? <ApercuDocumentBouton href={facture.documentUrl} titre={`Facture ${facture.numero ? `N° ${facture.numero}` : "sans numéro"}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">📄 Voir le document</ApercuDocumentBouton>
          : <span className="text-sm text-muted-foreground">Aucun document joint.</span>}
        {estDirection && <JoindreDocument id={facture.id} aDeja={!!facture.documentUrl} />}
      </section>

      {/* Historique des paiements (totaux ou partiels) */}
      {facture.paiements.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Paiements</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {facture.paiements.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-muted-foreground">
                  {p.type === "AVOIR" && <span className="mr-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Avoir</span>}
                  {new Date(p.date).toLocaleDateString("fr-FR")}{p.modePaiement ? ` · ${p.modePaiement}` : ""}{p.note ? ` · ${p.note}` : ""}
                  {/* Versé dans l'autre devise que la facture : le montant réellement versé et le taux qui l'a converti. */}
                  {p.devise === "CDF"
                    ? (p.montantUSD !== null ? <span className="ml-1 text-xs">(payé {usd(Number(p.montantUSD))}{p.tauxChangeUtilise ? ` au taux de ${formaterNombre(Number(p.tauxChangeUtilise))} FC/$` : ""})</span> : null)
                    : (p.montantCDF ? <span className="ml-1 text-xs">(payé {formaterFC(Number(p.montantCDF))}{p.tauxChangeUtilise ? ` au taux de ${formaterNombre(Number(p.tauxChangeUtilise))} FC/$` : ""})</span> : null)}
                </span>
                <span className="font-semibold tabular-nums text-emerald-700">{p.devise === "CDF" ? formaterMontantFacture(Number(p.montantCDF), "CDF") : usd(Number(p.montantUSD))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Lignes de la facture */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Articles facturés</h2>
        <div className="tableau-normal rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="en-tete-collante bg-muted text-left">
              <tr className="[&>th]:px-3 [&>th]:py-2">
                <th>Article</th><th>Unité</th><th className="text-right">Quantité</th><th className="text-right">P.U.{enFC ? " (FC)" : ""}</th><th className="text-right">Total{enFC ? " (FC)" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {facture.lignes.map((l) => (
                <tr key={l.id} className="border-t even:bg-muted/25">
                  <td className="px-3 py-2 font-medium">{l.articleId ? <Link href={`/stock/catalogue/${l.articleId}`} className="text-primary hover:underline">{libelleLigneArticle(l)}</Link> : l.designation}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.unite ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{qte(l.quantite)}</td>
                  <td className="px-3 py-2 text-right">{prixLigne(l)}</td>
                  <td className="px-3 py-2 text-right">{fm(totalLigne(l))}</td>
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
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="bg-muted text-left">
                  <tr className="[&>th]:px-3 [&>th]:py-2">
                    <th>Article</th>
                    <th className="text-right">Qté cmd</th>
                    <th className="text-right">Qté fact</th>
                    <th className="text-right">Écart qté</th>
                    <th className="text-right">Total cmd</th>
                    <th className="text-right">Total fact{enFC ? " (FC)" : ""}</th>
                    <th className="text-right">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesRecon.map((l, i) => {
                    const eQte = l.qteFac - l.qteBC;
                    const eTot = l.totFac - l.totBC;
                    return (
                      <tr key={i} className="border-t even:bg-muted/25">
                        <td className="px-3 py-2 font-medium">{l.articleId ? <Link href={`/stock/catalogue/${l.articleId}`} className="text-primary hover:underline">{l.libelle}</Link> : l.libelle}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{l.qteBC ? qte(l.qteBC) : "—"}</td>
                        <td className="px-3 py-2 text-right">{l.qteFac ? qte(l.qteFac) : "—"}</td>
                        <td className={`px-3 py-2 text-right ${eQte ? "font-medium text-amber-700" : "text-muted-foreground"}`}>{eQte ? `${eQte > 0 ? "+" : ""}${qte(eQte)}` : "0"}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{l.totBC ? usd(l.totBC) : "—"}</td>
                        <td className="px-3 py-2 text-right">{l.totFac ? fm(l.totFac) : "—"}</td>
                        {/* Bon en dollars, facture en francs : pas d'écart de montant entre deux devises (jamais converti en silence). */}
                        <td className="px-3 py-2 text-right text-muted-foreground">{enFC ? "—" : Math.abs(eTot) > 0.009 ? `${eTot > 0 ? "+" : ""}${usd(eTot)}` : "0"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-semibold [&>td]:px-3 [&>td]:py-2">
                    <td colSpan={4}>Totaux</td>
                    <td className="text-right">{usd(totBC)}</td>
                    <td className="text-right">{fm(totFac)}</td>
                    <td className="text-right text-muted-foreground">{enFC ? "—" : <>{ecartTotal >= 0 ? "+" : ""}{usd(ecartTotal)}</>}</td>
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
                      return <li key={i}>{l.libelle} : commandé {qte(l.qteBC)}, facturé {qte(l.qteFac)} ({e > 0 ? "+" : ""}{qte(e)})</li>;
                    })}
                  </ul>
                  <p className="mt-1 text-[11px]">Une différence de montant n’affecte pas la somme à payer : c’est le montant de la facture qui fait foi.</p>
                  {enFC && <p className="mt-1 text-[11px]">Bon de commande en dollars, facture en francs : les montants ne se comparent pas (devises différentes) ; seules les quantités le sont.</p>}
                </div>
              )}
          </>
        )}
      </section>
    </div>
  );
}

function Info({ label, val, accent, sous }: { label: string; val: string; accent?: boolean; sous?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-medium ${accent ? "text-red-700" : ""}`}>{val}</p>
      {sous && <p className="text-[11px] text-muted-foreground">{sous}</p>}
    </div>
  );
}
