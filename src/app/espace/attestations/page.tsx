import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { TelechargerLien } from "@/components/telecharger-lien";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";
import { jourKinshasa } from "@/lib/heure-kinshasa";
import { LIBELLE_STATUT_ATTESTATION, LIBELLE_TYPE_ATTESTATION } from "@/lib/attestations-donnees";
import { FormulaireDemande } from "./formulaire";
import { ObtenirAttestationSalaire } from "./salaire-libre-service";

const COULEUR: Record<string, string> = {
  DEMANDEE: "bg-amber-100 text-amber-800",
  DELIVREE: "bg-emerald-100 text-emerald-800",
  REFUSEE: "bg-red-100 text-red-800",
};

/** « Mes attestations » : demander, suivre, télécharger l'exemplaire délivré par la Direction. */
export default async function EspaceAttestations() {
  const s = await chargerSalarie();
  const attestations = await prisma.attestation.findMany({
    where: { employeeId: s.employeeId },
    orderBy: { demandeLe: "desc" },
    take: 100,
  });
  // L'attestation de SALAIRE s'obtient en libre-service (ci-dessous) : seules travail et stage se demandent.
  const types = (["TRAVAIL", "STAGE"] as const).map((v) => ({ v, label: LIBELLE_TYPE_ATTESTATION[v] }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mes attestations</h1>
        <p className="text-sm text-muted-foreground">
          L&apos;attestation de salaire s&apos;obtient tout de suite. Les autres se demandent : la Direction les délivre, numérotées et signées, ou vous dit pourquoi elle ne le peut pas.
        </p>
      </div>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-base font-semibold">Attestation de salaire</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Tout de suite, sans attendre la Direction : elle reprend votre dernière paie validée, avec un numéro et la signature de la Direction.
        </p>
        <ObtenirAttestationSalaire />
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">Demander une attestation de travail ou de stage</h2>
        <FormulaireDemande types={types} />
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-2 text-base font-semibold">Mes demandes et attestations</h2>
        {attestations.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune attestation pour le moment.</p>
        ) : (
          <ul className="divide-y">
            {attestations.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {LIBELLE_TYPE_ATTESTATION[a.type]}
                    {a.numero && <span className="ml-2 font-mono text-xs text-muted-foreground">{a.numero}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.statut === "DELIVREE" && a.delivreeLe
                      ? `Délivrée le ${jourKinshasa(a.delivreeLe)}`
                      : `Demandée le ${jourKinshasa(a.demandeLe)}`}
                    {a.motif ? ` · ${a.motif}` : ""}
                  </p>
                  {a.statut === "REFUSEE" && a.motifRefus && <p className="text-xs text-destructive">Refusée : {a.motifRefus}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR[a.statut]}`}>
                    {LIBELLE_STATUT_ATTESTATION[a.statut]}
                  </span>
                  {a.statut === "DELIVREE" && (
                    <>
                      <ContratViewerButton href={`/espace/attestations/${a.id}`} titre={`${LIBELLE_TYPE_ATTESTATION[a.type]} ${a.numero}`} libelle="Voir" className="text-primary underline" />
                      <TelechargerLien href={`/espace/attestations/${a.id}?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
