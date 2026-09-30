import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { usd } from "@/lib/stock";
import { validerBonCommande } from "../commandes/actions";
import { BoutonValider, CLASSES_NEUTRE } from "@/components/action-buttons";
import { exigerPageStock } from "@/lib/garde-page";
import { apercusDemandes } from "@/lib/validations-stock/apercu";
import { NATURE_LIBELLE } from "@/lib/validations-stock/charge";
import { DemandesAValider } from "./demandes-client";

const STATUT_DECISION: Record<string, { texte: string; cls: string }> = {
  VALIDEE: { texte: "Validée", cls: "bg-emerald-100 text-emerald-800" },
  REFUSEE: { texte: "Refusée", cls: "bg-red-100 text-red-800" },
  ANNULEE: { texte: "Retirée", cls: "bg-muted text-muted-foreground" },
};
const quand = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Kinshasa" }) : "—");

// File « Demandes à valider » de l'espace Stock : bons de commande en brouillon, puis les demandes
// que la Direction doit trancher (paiements de factures, réconciliations, modifications d'articles).
// Un compte qui n'est pas la Direction y voit SES demandes (en attente, et les dernières décisions).
export default async function AValiderPage() {
  const user = await exigerPageStock();
  const estDirection = user.role === "ADMIN";
  const miennes = estDirection ? {} : { auteurId: user.id };

  const [brouillons, enAttente, decidees] = await Promise.all([
    prisma.bonDeCommande.findMany({
      where: { statut: "BROUILLON" },
      orderBy: [{ annee: "desc" }, { sequence: "desc" }],
      include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } } },
    }),
    apercusDemandes({ statut: "EN_ATTENTE", ...miennes }, { detail: true }),
    apercusDemandes({ statut: { not: "EN_ATTENTE" }, ...miennes }, { take: 15 }),
  ]);

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Demandes à valider</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {estDirection
            ? "Bons de commande, paiements de factures, réconciliations du stock et modifications d'articles en attente de votre décision. Tant qu'une demande n'est pas validée, rien n'est payé ni modifié."
            : "Vos demandes en attente de la Direction : rien n'est payé ni modifié tant qu'elle ne les a pas validées."}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Bons de commande ({brouillons.length})</h2>
        {brouillons.length === 0 ? (
          <p className="rounded-lg border bg-muted/30 px-4 py-4 text-center text-sm text-muted-foreground">Aucun bon de commande en attente.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {brouillons.map((bc) => (
              <li key={bc.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <Link href={`/stock/commandes/${bc.id}`} className="font-medium text-primary underline">{bc.numero}</Link>
                  <span className="text-sm text-muted-foreground"> · {bc.fournisseur?.nom ?? "—"} · {bc._count.lignes} ligne(s) · {usd(bc.totalUSD)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/stock/commandes/${bc.id}`} className={CLASSES_NEUTRE}>Voir l&apos;aperçu</Link>
                  {estDirection ? (
                    <form action={validerBonCommande.bind(null, bc.id)}>
                      <BoutonValider type="submit" />
                    </form>
                  ) : (
                    <span className="text-xs text-amber-700">En attente Direction</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">{estDirection ? "Paiements, réconciliations et articles" : "Mes demandes"} ({enAttente.length})</h2>
        <DemandesAValider demandes={enAttente} estDirection={estDirection} />
      </section>

      {decidees.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{estDirection ? "Dernières décisions" : "Mes dernières demandes traitées"}</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {decidees.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{d.resume}</p>
                  <p className="text-xs text-muted-foreground">
                    {NATURE_LIBELLE[d.nature]} · demandé par {d.auteurNom} le {quand(d.creeLe)}
                    {d.decideLe ? ` · ${d.statut === "ANNULEE" ? "retirée" : `décidée par ${d.decideurNom ?? "—"}`} le ${quand(d.decideLe)}` : ""}
                  </p>
                  {d.motifRefus && <p className="text-xs text-red-800">Motif : {d.motifRefus}</p>}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_DECISION[d.statut]?.cls ?? ""}`}>{STATUT_DECISION[d.statut]?.texte ?? d.statut}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
