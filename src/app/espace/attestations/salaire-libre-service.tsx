"use client";

import { useState, useTransition } from "react";
import { estErreur } from "@/lib/action-lisible";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";
import { TelechargerLien } from "@/components/telecharger-lien";
import { obtenirMonAttestationSalaire } from "./actions";

type Resultat = { id: string; numero: string; existante: boolean };

/**
 * « Obtenir mon attestation de salaire » — libre-service, sans attendre la Direction. Le refus
 * (aucune paie validée…) revient comme un message ; le succès donne le document tout de suite.
 */
export function ObtenirAttestationSalaire() {
  const [enCours, demarrer] = useTransition();
  const [ok, setOk] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={enCours}
        onClick={() => {
          setErreur(null);
          demarrer(async () => {
            const r = await obtenirMonAttestationSalaire();
            if (estErreur(r)) {
              setOk(null);
              setErreur(r.erreur);
              return;
            }
            setOk(r);
          });
        }}
        className="min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:w-auto"
      >
        {enCours ? "Préparation…" : "Obtenir mon attestation de salaire"}
      </button>

      {erreur && <p role="alert" className="text-sm text-destructive">{erreur}</p>}
      {ok && (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p>
            {ok.existante
              ? `Votre attestation de salaire de ce mois existe déjà : la voici (${ok.numero}).`
              : `Votre attestation de salaire est prête (${ok.numero}).`}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            <ContratViewerButton href={`/espace/attestations/${ok.id}`} titre={`Attestation de salaire ${ok.numero}`} libelle="Voir" className="font-medium text-primary underline" />
            <TelechargerLien href={`/espace/attestations/${ok.id}?dl=1`} className="font-medium text-primary underline">Télécharger</TelechargerLien>
          </p>
        </div>
      )}
    </div>
  );
}
