import Link from "next/link";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { formaterMontantFacture, libelleTotal, totalFactures } from "@/lib/facture-devise";
import { FilAriane } from "@/components/fil-ariane";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { usd, qte, STATUT_BC_LABEL, STATUT_BC_CLASSE, delaiPaiementLabel } from "@/lib/stock";
import { compterSansPrixBon, deviseBon, formaterMontantBon, libelleTotalBon, prixLigneBon, totalLigneBon } from "@/lib/bon-commande-devise";
import { quantiteRecueAffichee, resteARecevoir } from "@/lib/reception-bc";
import { symboleDevise } from "@/lib/facture-devise";
import { changerStatutBonCommande, validerBonCommande, supprimerBonCommande } from "../actions";
import { ReceptionForm } from "./reception-client";
import { LierFacture } from "./lier-facture";
import { BoutonValider, CLASSES_NEUTRE } from "@/components/action-buttons";
import { exigerPageStock } from "@/lib/garde-page";
import { TelechargerLien } from "@/components/telecharger-lien";
import { ApercuDocumentBouton } from "@/components/apercu-document";
import { lireRetourFiche } from "@/lib/fiche-fournisseur";
import { CHAMPS_CONTENANCE, libelleLigneArticle } from "@/lib/libelle-article";

export default async function BonDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string; retour?: string }> }) {
  const user = await exigerPageStock();
  const { id } = await params;
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  const [bc, acheteur] = await Promise.all([
    prisma.bonDeCommande.findUnique({
      where: { id },
      include: {
        lignes: { include: { article: { select: CHAMPS_CONTENANCE } } }, // contenance de l'article lié : libellé de la ligne
        fournisseur: true,
        receptions: { orderBy: { date: "desc" } },
        factures: { orderBy: { date: "desc" } },
      },
    }),
    prisma.parametresAchat.findUnique({ where: { id: "singleton" } }),
  ]);
  if (!bc) notFound();
  const retour = lireRetourFiche(sp.retour, bc.fournisseurId);

  // Factures non liées du même fournisseur, à rattacher à ce bon à tout moment.
  const facturesLiablesRaw = bc.fournisseurId
    ? await prisma.factureFournisseur.findMany({
        where: { fournisseurId: bc.fournisseurId, bonDeCommandeId: null },
        orderBy: { date: "desc" }, take: 100,
        select: { id: true, numero: true, date: true, devise: true, montantUSD: true, montantCDF: true },
      })
    : [];
  const facturesLiables = facturesLiablesRaw.map((f) => ({
    id: f.id,
    libelle: (f.numero ? `Facture ${f.numero}` : "Facture") + (f.date ? ` · ${new Date(f.date).toLocaleDateString("fr-FR")}` : ""),
    montant: Number(f.montantUSD ?? 0),
    ...(f.devise === "CDF" ? { montantTexte: formaterMontantFacture(Number(f.montantCDF), "CDF") } : {}),
  }));

  // Toutes les lignes se réceptionnent, lignes libres (sans article du catalogue) comprises : seules celles qui
  // ont encore un reste sont proposées, pré-remplies de CE reste (la réception s'ajoute au cumul déjà reçu).
  const lignesAReceptionner = bc.lignes
    .map((l) => ({ id: l.id, designation: libelleLigneArticle(l), quantite: l.quantite.toString(), recue: quantiteRecueAffichee(bc.statut, l), reste: resteARecevoir(l.quantite, quantiteRecueAffichee(bc.statut, l) ?? 0), libre: !l.articleId }))
    .filter((l) => Number(l.reste) > 0);
  const estBrouillon = bc.statut === "BROUILLON";
  const peutExporter = !estBrouillon && bc.statut !== "ANNULE";
  const receptionnable = ["VALIDE", "ENVOYE", "RECU_PARTIEL"].includes(bc.statut) && lignesAReceptionner.length > 0;
  const devise = deviseBon(bc);
  const nbSansPrix = compterSansPrixBon(bc.lignes, devise);
  const sym = symboleDevise(devise);
  // Une facture dans l'autre devise que le bon ne s'y compare pas (jamais convertie en silence) :
  // le facturé se dit par devise, l'écart n'est calculé que dans la devise du bon.
  const facturesDevises = totalFactures(bc.factures, "montant");
  // L'écart ne se calcule que dans UNE devise : celle du bon, avec des factures de cette seule devise, et un bon
  // dont toutes les lignes sont chiffrées (un total partiel n'est pas comparable à un facturé complet).
  const bonEnFrancs = devise === "CDF";
  const ecartFacture = bonEnFrancs ? facturesDevises.cdf - Number(bc.totalCDF ?? 0) : facturesDevises.usd - Number(bc.totalUSD ?? 0);
  const motifNonComparable = bonEnFrancs && facturesDevises.nbUSD > 0 ? "— (bon en francs, facture en dollars : non comparés)"
    : !bonEnFrancs && facturesDevises.nbCDF > 0 ? "— (facture en francs, bon en dollars : non comparés)"
    : null;
  const nonComparable = motifNonComparable ?? (nbSansPrix > 0 ? "— (bon incomplet : lignes sans prix)" : null);

  return (
    <div className="w-full space-y-5">
      {/* Ouvert depuis la fiche d'un fournisseur : on y revient, sur le bon onglet (`?retour=` validé, jamais cru tel quel). */}
      <FilAriane segments={[...(retour && bc.fournisseur
        ? [{ label: "Fournisseurs", href: "/stock/fournisseurs" }, { label: bc.fournisseur.nom, href: retour }]
        : [{ label: "Bons de commande", href: "/stock/commandes" }]), { label: bc.numero }]} />
      {sp.erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      {/* Barre d'actions selon l'état */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUT_BC_CLASSE[bc.statut]}`}>{STATUT_BC_LABEL[bc.statut]}</span>
        <div className="flex flex-wrap items-center gap-2">
          {estBrouillon ? (
            <>
              <Link href={`/stock/commandes/${bc.id}/modifier`} className={CLASSES_NEUTRE}>Modifier le brouillon</Link>
              {estDirection ? (
                <form action={validerBonCommande.bind(null, bc.id)}>
                  <BoutonValider type="submit">Valider le bon de commande</BoutonValider>
                </form>
              ) : (
                <span className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">En attente de validation par la Direction</span>
              )}
            </>
          ) : (
            <>
              {peutExporter && (
                <TelechargerLien href={`/stock/commandes/${bc.id}/pdf`} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                  Télécharger le PDF
                </TelechargerLien>
              )}
              {bc.statut === "VALIDE" && (
                <form action={changerStatutBonCommande.bind(null, bc.id)}>
                  <input type="hidden" name="statut" value="ENVOYE" />
                  <button className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Marquer comme envoyé</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {estBrouillon && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ce bon est un <strong>brouillon</strong>. Vérifiez l&apos;aperçu ci-dessous, puis <strong>validez-le</strong> :
          l&apos;export PDF, l&apos;impression et l&apos;envoi ne sont possibles qu&apos;après validation.
        </p>
      )}

      {/* Aperçu du bon de commande */}
      <div className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/30 px-5 py-3">
          <h2 className="text-lg font-semibold">Bon de commande N° {bc.numero}</h2>
          <div className="flex items-center gap-3 text-sm">
            {bc.documentUrl && <ApercuDocumentBouton href={bc.documentUrl} titre={`Bon de commande N° ${bc.numero} (PDF d'origine)`} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">📄 PDF d&apos;origine</ApercuDocumentBouton>}
            <span className="text-muted-foreground">Date : {new Date(bc.date).toLocaleDateString("fr-FR")}</span>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Partie titre="Fournisseur" lignes={[
            ["Nom", bc.fournisseurId && bc.fournisseur
              ? <Link href={`/stock/fournisseurs/${bc.fournisseurId}`} className="font-medium text-primary hover:underline">{bc.fournisseur.nom}</Link>
              : (bc.fournisseur?.nom ?? "—")],
            ["Ville", bc.fournisseur?.ville ?? "—"],
            ["Téléphone", bc.fournisseur?.telephone ?? "—"],
            ["RCCM", bc.fournisseur?.rccm ?? "—"],
            ["Contact", bc.fournisseur?.contactNom ?? "—"],
          ]} />
          <Partie titre="Acheteur" lignes={[
            ["Nom", acheteur?.acheteurNom ?? "TOLYA SARL"],
            ["Ville", acheteur?.acheteurVille ?? "—"],
            ["Adresse", acheteur?.acheteurAdresse ?? "—"],
            ["Téléphone", acheteur?.acheteurTelephone ?? "—"],
            ["RCCM", acheteur?.acheteurRccm ?? "—"],
          ]} />
        </div>

        <div className="px-5 pb-5">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5">Désignation</th>
                <th className="py-1.5 text-right">Quantité</th>
                <th className="py-1.5 text-right">Cartons</th>
                <th className="py-1.5 text-right">P.U. {sym}</th>
                <th className="py-1.5 text-right">Total {sym}</th>
                {!estBrouillon && <th className="py-1.5 text-right">Reçu / commandé</th>}
              </tr>
            </thead>
            <tbody>
              {bc.lignes.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-1.5">{l.articleId ? <Link href={`/stock/catalogue/${l.articleId}`} className="text-primary hover:underline">{libelleLigneArticle(l)}</Link> : l.designation}</td>
                  <td className="py-1.5 text-right">{qte(l.quantite)}</td>
                  <td className="py-1.5 text-right">{l.nbCartons ? qte(l.nbCartons) : "—"}</td>
                  {/* Ligne sans prix : « — » et signalée, jamais 0. */}
                  <td className="py-1.5 text-right">{prixLigneBon(l, devise) === null ? <span className="text-amber-800" data-sans-prix>sans prix</span> : formaterMontantBon(prixLigneBon(l, devise)!, devise)}</td>
                  <td className="py-1.5 text-right">{totalLigneBon(l, devise) === null ? "—" : formaterMontantBon(totalLigneBon(l, devise)!, devise)}</td>
                  {!estBrouillon && <CelluleRecu statut={bc.statut} l={l} />}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2" colSpan={4}>Total</td>
                <td className="py-2 text-right" colSpan={estBrouillon ? 1 : 2}>{libelleTotalBon(bc, nbSansPrix, bc.lignes.length)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="mt-3 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span>Délai de paiement : {delaiPaiementLabel(bc.delaiPaiement)}</span>
            <span>Délai de livraison : {bc.fournisseur?.delaiLivraison ?? "—"}</span>
            <span>Mode de paiement : {bc.modePaiement ?? "—"}</span>
          </div>
          {bc.commentaire && <p className="mt-2 text-sm text-muted-foreground">Note : {bc.commentaire}</p>}
        </div>
      </div>

      {/* Réception */}
      {!estBrouillon && (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Réception</h2>
            {receptionnable && <ReceptionForm bcId={bc.id} lignes={lignesAReceptionner} />}
          </div>
          {bc.receptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune réception enregistrée. À l&apos;arrivée de la marchandise, enregistrez les quantités reçues : cela met à jour le statut du bon. L&apos;entrée en stock, elle, se fait à l&apos;enregistrement de la facture fournisseur (pas à la réception).</p>
          ) : (
            <ul className="divide-y text-sm">
              {bc.receptions.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5">
                  <span>Réception du {new Date(r.date).toLocaleDateString("fr-FR")}</span>
                  <span className="text-muted-foreground">marchandise reçue</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Comparaison avec la/les facture(s) */}
      <div className="rounded-lg border p-4">
        <h2 className="mb-3 text-base font-semibold">Comparaison commande / facture</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
          <span className="text-sm font-medium">Rattacher une facture :</span>
          <LierFacture bcId={bc.id} factures={facturesLiables} />
        </div>
        {bc.factures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune facture liée pour l&apos;instant. Enregistrez la facture depuis l&apos;onglet
            <span className="font-medium"> Factures</span>, puis rattachez-la ci-dessus (ou depuis la facture).
          </p>
        ) : (
          <>
            <ul className="mb-3 divide-y text-sm">
              {bc.factures.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-1.5">
                  <span>{f.numero ? `Facture ${f.numero}` : "Facture"}{f.date ? ` · ${new Date(f.date).toLocaleDateString("fr-FR")}` : ""}</span>
                  <span className="font-medium">{f.devise === "CDF" ? formaterMontantFacture(Number(f.montantCDF), "CDF") : usd(f.montantUSD)}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Commandé</p><p className="font-semibold">{libelleTotalBon(bc, nbSansPrix, bc.lignes.length)}</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Facturé</p><p className="font-semibold">{libelleTotal(facturesDevises, undefined, usd)}</p></div>
              {nonComparable ? (
                <div className="rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">Écart</p>
                  <p className="text-xs text-muted-foreground">{nonComparable}</p>
                </div>
              ) : (
              <div className={`rounded-md border p-2 ${Math.abs(ecartFacture) < 0.01 ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                <p className="text-xs text-muted-foreground">Écart</p>
                <p className={`font-semibold ${Math.abs(ecartFacture) < 0.01 ? "text-emerald-700" : "text-amber-800"}`}>{ecartFacture > 0 ? "+" : ""}{formaterMontantBon(ecartFacture, devise)}</p>
              </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Statut avancé (corrections) + suppression */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={changerStatutBonCommande.bind(null, bc.id)} className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Corriger le statut :</span>
          <select name="statut" defaultValue={bc.statut} className="rounded border border-input bg-background px-2 py-1 text-xs">
            {/* Annulé, ou retour en brouillon d'un bon déjà envoyé : Direction seulement (le serveur refuse aussi). */}
            {Object.entries(STATUT_BC_LABEL)
              .filter(([k]) => estDirection || k === bc.statut || (k !== "ANNULE" && k !== "BROUILLON"))
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Appliquer</button>
        </form>
        {estDirection && (
          <form action={supprimerBonCommande.bind(null, bc.id)}>
            <ConfirmSubmitButton message={`Supprimer le bon de commande ${bc.numero} ? Action irréversible.`} className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10">Supprimer ce bon de commande</ConfirmSubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

/** Reçu / commandé d'une ligne : « — » tant qu'aucune quantité n'est enregistrée (jamais 0 par défaut). */
function CelluleRecu({ statut, l }: { statut: string; l: { quantite: { toString(): string }; quantiteRecue: { toString(): string } | null } }) {
  const recue = quantiteRecueAffichee(statut, l);
  if (recue === null) return <td className="py-1.5 text-right text-muted-foreground" data-recu="inconnu">—</td>;
  const complet = recue >= Number(l.quantite);
  return <td className={`py-1.5 text-right tabular-nums ${complet ? "text-emerald-700" : "text-amber-800"}`} data-recu={complet ? "complet" : "partiel"}>{qte(recue)} / {qte(Number(l.quantite.toString()))}</td>;
}

function Partie({ titre, lignes }: { titre: string; lignes: [string, React.ReactNode][] }) {
  return (
    <div className="rounded-md border">
      <div className="border-b bg-muted/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titre}</div>
      <div className="p-3 text-sm">
        {lignes.map(([k, v]) => (
          <div key={k} className="flex gap-2 py-0.5">
            <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
            <span className="flex-1">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
