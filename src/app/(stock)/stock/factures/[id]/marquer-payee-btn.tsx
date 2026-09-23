"use client";

import { useState, useTransition } from "react";
import { marquerPayee } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { dateDuJourKinshasa } from "@/lib/date-paiement";
import { BoutonValider, BoutonNeutre } from "@/components/action-buttons";

/**
 * « Marquer payée » à l'unité : un petit champ date (préremplie à aujourd'hui, heure de
 * Kinshasa) + Confirmer/Annuler — un seul geste après le choix de la date, dans l'esprit du
 * formulaire détaillé « + Paiement / Avoir ». La date est revalidée côté serveur (voir
 * `lireDatePaiement` / `appliquerReglement`) : ce composant ne fait que la proposer.
 */
export function MarquerPayeeBtn({ id }: { id: string }) {
  const [ouvert, setOuvert] = useState(false);
  const [date, setDate] = useState(() => dateDuJourKinshasa());
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const confirmer = () => {
    setErreur(null);
    start(async () => {
      const r = await marquerPayee(id, date);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setOuvert(false);
    });
  };

  if (!ouvert) {
    return (
      <div className="flex items-center gap-2">
        <BoutonValider onClick={() => setOuvert(true)}>Marquer payée</BoutonValider>
        {erreur && <span className="text-xs text-destructive">{erreur}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date de paiement
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={dateDuJourKinshasa()} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </label>
      <BoutonValider onClick={confirmer} disabled={isPending}>{isPending ? "…" : "Confirmer"}</BoutonValider>
      <BoutonNeutre onClick={() => { setOuvert(false); setErreur(null); }}>Annuler</BoutonNeutre>
      {erreur && <span className="w-full text-xs text-destructive">{erreur}</span>}
    </div>
  );
}
