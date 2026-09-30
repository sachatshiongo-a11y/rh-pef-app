"use client";

import { useState, useTransition } from "react";
import { validerDemandes, refuserDemandes, retirerMaDemande } from "./actions";
import { estErreur } from "@/lib/action-lisible";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { BoutonApprouver, BoutonRefuser, BoutonNeutre } from "@/components/action-buttons";

/**
 * Décision sur UNE demande, là où elle se voit (fiche facture, fiche article) : Valider / Refuser
 * (motif) pour la Direction, « Retirer ma demande » pour son auteur. Mêmes actions serveur que la
 * page « Demandes à valider » — qui revérifient les droits, ce bouton n'est qu'un raccourci.
 * `dateProposee` : demande de paiement → la Direction peut corriger la date avant de valider.
 */
export function DecisionDemande({ id, estDirection, estAuteur, dateProposee }: { id: string; estDirection: boolean; estAuteur: boolean; dateProposee?: string }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");
  const [date, setDate] = useState(dateProposee ?? "");

  const agir = (fn: () => Promise<unknown>) => {
    setErreur(null);
    start(async () => {
      const r = await fn();
      if (estErreur(r)) { setErreur(r.erreur); return; }
      const echec = r && typeof r === "object" && "echecs" in r ? (r as { echecs: { erreur: string }[] }).echecs[0] : undefined;
      if (echec) setErreur(echec.erreur);
    });
  };

  if (!estDirection && !estAuteur) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {estDirection && dateProposee && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date de paiement
            <input type="date" value={date} max={jourKinshasaISO()} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
          </label>
        )}
        {estDirection && !refus && (
          <>
            <BoutonApprouver disabled={isPending} onClick={() => agir(() => validerDemandes([id], dateProposee ? { [id]: date } : {}))}>Valider</BoutonApprouver>
            <BoutonRefuser disabled={isPending} onClick={() => setRefus(true)}>Refuser</BoutonRefuser>
          </>
        )}
        {estDirection && refus && (
          <>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">Motif du refus *
              <input value={motif} onChange={(e) => setMotif(e.target.value)} autoFocus placeholder="ex. facture contestée, recompter…" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
            </label>
            <BoutonRefuser disabled={isPending || motif.trim().length < 3} onClick={() => agir(() => refuserDemandes([id], motif))}>Confirmer le refus</BoutonRefuser>
            <BoutonNeutre onClick={() => { setRefus(false); setMotif(""); }}>Annuler</BoutonNeutre>
          </>
        )}
        {!estDirection && estAuteur && (
          <BoutonNeutre disabled={isPending} onClick={() => { if (confirm("Retirer cette demande ? Rien n'aura été fait.")) agir(() => retirerMaDemande(id)); }}>Retirer ma demande</BoutonNeutre>
        )}
      </div>
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
    </div>
  );
}
