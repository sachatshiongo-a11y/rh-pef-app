"use client";

import { useState, useTransition } from "react";
import { marquerPayee } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { BoutonValider, BoutonNeutre } from "@/components/action-buttons";
import { lireNombreSaisi } from "@/lib/nombre";
import { BasculeDevise, SaisieFrancs, francsProposes, type DevisePaiement } from "../devise-paiement";

/**
 * « Marquer payée » à l'unité : un petit champ date (préremplie à aujourd'hui, heure de
 * Kinshasa) + Confirmer/Annuler — un seul geste après le choix de la date, dans l'esprit du
 * formulaire détaillé « + Paiement / Avoir ». La date est revalidée côté serveur (voir
 * `lireDatePaiement` / `appliquerReglement`) : ce composant ne fait que la proposer.
 */
export function MarquerPayeeBtn({ id, estDirection = true, reste = 0, taux = 0 }: { id: string; estDirection?: boolean; reste?: number; taux?: number }) {
  const [ouvert, setOuvert] = useState(false);
  const [date, setDate] = useState(() => jourKinshasaISO());
  // Devise du paiement (2026-10-08) : en francs, montant proposé = reste × taux du jour, modifiable.
  const [devise, setDevise] = useState<DevisePaiement>("USD");
  const [francs, setFrancs] = useState("");
  const choisirDevise = (d: DevisePaiement) => { setDevise(d); if (d === "CDF" && !francs) setFrancs(francsProposes(reste, taux)); };
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const confirmer = () => {
    setErreur(null);
    start(async () => {
      const r = await marquerPayee(id, date, devise === "CDF" ? francs : undefined);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setOuvert(false);
    });
  };

  if (!ouvert) {
    return (
      <div className="flex items-center gap-2">
        {/* Hors Direction, le geste DEMANDE le paiement (validé ensuite par la Direction). */}
        <BoutonValider onClick={() => setOuvert(true)}>{estDirection ? "Marquer payée" : "Demander le paiement"}</BoutonValider>
        {erreur && <span className="text-xs text-destructive">{erreur}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date de paiement
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={jourKinshasaISO()} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
      </label>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">Payée en
        <BasculeDevise devise={devise} onDevise={choisirDevise} taux={taux} />
      </div>
      {devise === "CDF" && <SaisieFrancs francs={francs} onFrancs={setFrancs} reste={reste} taux={taux} demande={!estDirection} />}
      <BoutonValider onClick={confirmer} disabled={isPending || (devise === "CDF" && !((lireNombreSaisi(francs) ?? 0) > 0))}>{isPending ? "…" : estDirection ? "Confirmer" : "Envoyer la demande"}</BoutonValider>
      <BoutonNeutre onClick={() => { setOuvert(false); setErreur(null); }}>Annuler</BoutonNeutre>
      {erreur && <span className="w-full text-xs text-destructive">{erreur}</span>}
    </div>
  );
}
