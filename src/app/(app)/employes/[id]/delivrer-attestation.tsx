"use client";

import { useState, useTransition } from "react";
import { BoutonValider } from "@/components/action-buttons";
import { TelechargerLien } from "@/components/telecharger-lien";
import { estErreur } from "@/lib/action-lisible";
import { LIBELLE_TYPE_ATTESTATION, type TypeAttestationCode } from "@/lib/attestations-donnees";
import { delivrerAttestationDirecte } from "../../attestations/actions";

const inputCls = "min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * « Délivrer une attestation » depuis la fiche : l'attestation naît DÉJÀ délivrée — numérotée,
 * figée, tracée — puis se télécharge. Plus aucune attestation ne sort sans numéro ni trace.
 */
export function DelivrerAttestation({ employeeId }: { employeeId: string }) {
  const [type, setType] = useState<TypeAttestationCode>("TRAVAIL");
  const [resultat, setResultat] = useState<{ id: string; numero: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={type} onChange={(e) => setType(e.target.value as TypeAttestationCode)} className={inputCls} aria-label="Type d'attestation">
        {(Object.keys(LIBELLE_TYPE_ATTESTATION) as TypeAttestationCode[]).map((t) => (
          <option key={t} value={t}>{LIBELLE_TYPE_ATTESTATION[t]}</option>
        ))}
      </select>
      <BoutonValider
        type="button"
        disabled={enCours}
        onClick={() => {
          setErreur(null);
          setResultat(null);
          demarrer(async () => {
            const r = await delivrerAttestationDirecte(employeeId, type);
            if (estErreur(r)) return setErreur(r.erreur);
            setResultat(r);
          });
        }}
      >
        {enCours ? "Délivrance…" : "Délivrer une attestation"}
      </BoutonValider>
      {resultat && (
        <span className="text-sm">
          {resultat.numero} délivrée —{" "}
          <TelechargerLien href={`/attestations/${resultat.id}?dl=1`} className="text-primary underline">Télécharger</TelechargerLien>
        </span>
      )}
      {erreur && <p role="alert" className="w-full text-sm text-destructive">{erreur}</p>}
    </div>
  );
}
