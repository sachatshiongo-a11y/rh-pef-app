import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { usd, qte, STATUT_BC_LABEL, STATUT_BC_CLASSE } from "@/lib/stock";
import { changerStatutBonCommande, validerBonCommande } from "../actions";
import { ReceptionForm } from "./reception-client";

export default async function BonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const [bc, acheteur] = await Promise.all([
    prisma.bonDeCommande.findUnique({
      where: { id },
      include: {
        lignes: true,
        fournisseur: true,
        receptions: { orderBy: { date: "desc" }, include: { _count: { select: { mouvements: true } } } },
        factures: { orderBy: { date: "desc" } },
      },
    }),
    prisma.parametresAchat.findUnique({ where: { id: "singleton" } }),
  ]);
  if (!bc) notFound();

  const lignesArticle = bc.lignes.filter((l) => l.articleId).map((l) => ({ id: l.id, designation: l.designation, quantite: l.quantite.toString() }));
  const estBrouillon = bc.statut === "BROUILLON";
  const peutExporter = !estBrouillon && bc.statut !== "ANNULE";
  const receptionnable = ["VALIDE", "ENVOYE", "RECU_PARTIEL"].includes(bc.statut) && lignesArticle.length > 0;
  const totalFacture = bc.factures.reduce((t, f) => t + Number(f.montantUSD), 0);
  const ecartFacture = totalFacture - Number(bc.totalUSD);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/stock/commandes" className="underline">Bons de commande</Link>
        <span>/</span>
        <span>{bc.numero}</span>
      </div>

      {/* Barre d'actions selon l'état */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUT_BC_CLASSE[bc.statut]}`}>{STATUT_BC_LABEL[bc.statut]}</span>
        <div className="flex flex-wrap items-center gap-2">
          {estBrouillon ? (
            estDirection ? (
              <form action={validerBonCommande.bind(null, bc.id)}>
                <button className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">✓ Valider le bon de commande</button>
              </form>
            ) : (
              <span className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">En attente de validation par la Direction</span>
            )
          ) : (
            <>
              {peutExporter && (
                <a href={`/stock/commandes/${bc.id}/pdf`} download className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                  ⬇ Télécharger le PDF
                </a>
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
        <div className="flex items-baseline justify-between border-b bg-muted/30 px-5 py-3">
          <h2 className="text-lg font-semibold">Bon de commande N° {bc.numero}</h2>
          <span className="text-sm text-muted-foreground">Date : {new Date(bc.date).toLocaleDateString("fr-FR")}</span>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Partie titre="Fournisseur" lignes={[
            ["Nom", bc.fournisseur?.nom ?? "—"],
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
                <th className="py-1.5 text-right">P.U. USD</th>
                <th className="py-1.5 text-right">Total USD</th>
              </tr>
            </thead>
            <tbody>
              {bc.lignes.map((l) => (
                <tr key={l.id} className="border-b">
                  <td className="py-1.5">{l.designation}</td>
                  <td className="py-1.5 text-right">{qte(l.quantite)}</td>
                  <td className="py-1.5 text-right">{l.nbCartons ? qte(l.nbCartons) : "—"}</td>
                  <td className="py-1.5 text-right">{usd(l.prixUnitaireUSD)}</td>
                  <td className="py-1.5 text-right">{usd(l.totalLigneUSD)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2" colSpan={4}>Total</td>
                <td className="py-2 text-right">{usd(bc.totalUSD)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="mt-3 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span>Délai de paiement : {bc.delaiPaiement ?? "—"}</span>
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
            {receptionnable && <ReceptionForm bcId={bc.id} lignes={lignesArticle} />}
          </div>
          {bc.receptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune réception enregistrée. À la réception des articles (avec leur facture), enregistrez les quantités reçues : l&apos;entrée en stock se fait ici.</p>
          ) : (
            <ul className="divide-y text-sm">
              {bc.receptions.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5">
                  <span>Réception du {new Date(r.date).toLocaleDateString("fr-FR")}</span>
                  <span className="text-muted-foreground">{r._count.mouvements} entrée(s) en stock</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Comparaison avec la/les facture(s) */}
      <div className="rounded-lg border p-4">
        <h2 className="mb-3 text-base font-semibold">Comparaison commande / facture</h2>
        {bc.factures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune facture liée. À la réception, enregistrez la facture depuis l&apos;onglet
            <span className="font-medium"> Factures</span> en la reliant à ce bon de commande.
          </p>
        ) : (
          <>
            <ul className="mb-3 divide-y text-sm">
              {bc.factures.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-1.5">
                  <span>{f.numero ? `Facture ${f.numero}` : "Facture"}{f.date ? ` · ${new Date(f.date).toLocaleDateString("fr-FR")}` : ""}</span>
                  <span className="font-medium">{usd(f.montantUSD)}</span>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Commandé</p><p className="font-semibold">{usd(bc.totalUSD)}</p></div>
              <div className="rounded-md border p-2"><p className="text-xs text-muted-foreground">Facturé</p><p className="font-semibold">{usd(totalFacture)}</p></div>
              <div className={`rounded-md border p-2 ${Math.abs(ecartFacture) < 0.01 ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                <p className="text-xs text-muted-foreground">Écart</p>
                <p className={`font-semibold ${Math.abs(ecartFacture) < 0.01 ? "text-emerald-700" : "text-amber-800"}`}>{ecartFacture > 0 ? "+" : ""}{usd(ecartFacture)}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Statut avancé (corrections) */}
      <form action={changerStatutBonCommande.bind(null, bc.id)} className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Corriger le statut :</span>
        <select name="statut" defaultValue={bc.statut} className="rounded border border-input bg-background px-2 py-1 text-xs">
          {Object.entries(STATUT_BC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Appliquer</button>
      </form>
    </div>
  );
}

function Partie({ titre, lignes }: { titre: string; lignes: [string, string][] }) {
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
