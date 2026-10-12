"use client";

import { useState, useTransition } from "react";
import { annulerPaiementFacture } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { BoutonDanger } from "@/components/action-buttons";

/** « Annuler ce paiement » (Direction) : le confirm() dit ce qui change — le reste retrouve le montant et la facture n'est plus réglée. */
export function AnnulerPaiementBtn({ paiementId, libelle, resteApres }: { paiementId: string; /** « paiement de 100 000 FC du 05/09/2026 » */ libelle: string; /** Reste à payer APRÈS l'annulation, formaté dans la devise de la facture. */ resteApres: string }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const annuler = () => {
    if (!confirm(`Annuler ce ${libelle} ?\n\nLa ligne de paiement sera supprimée et le reste à payer de la facture passera à ${resteApres} (la facture n'est plus « réglée » si elle l'était). L'opération est journalisée.`)) return;
    setErreur(null);
    start(async () => {
      const r = await annulerPaiementFacture(paiementId);
      if (estErreur(r)) setErreur(r.erreur);
    });
  };
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <BoutonDanger onClick={annuler} disabled={isPending} className="px-2 py-0.5">{isPending ? "…" : "Annuler ce paiement"}</BoutonDanger>
      {erreur && <span className="max-w-xs text-right text-[11px] text-destructive" role="alert">{erreur}</span>}
    </span>
  );
}
