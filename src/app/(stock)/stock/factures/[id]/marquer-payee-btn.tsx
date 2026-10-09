"use client";

import { useState, useTransition } from "react";
import { marquerPayee } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { BoutonValider, BoutonNeutre } from "@/components/action-buttons";
import { lireNombreSaisi } from "@/lib/nombre";
import { BasculeDevise, SaisieDollars, SaisieFrancs, dollarsProposes, francsProposes, type DevisePaiement } from "../devise-paiement";
import type { DeviseFacture } from "@/lib/facture-devise";

/**
 * « Marquer payée » à l'unité : un petit champ date (préremplie à aujourd'hui, heure de
 * Kinshasa) + Confirmer/Annuler — un seul geste après le choix de la date, dans l'esprit du
 * formulaire détaillé « + Paiement / Avoir ». La date est revalidée côté serveur (voir
 * `lireDatePaiement` / `appliquerReglement`) : ce composant ne fait que la proposer.
 */
export function MarquerPayeeBtn({ id, estDirection = true, reste = 0, taux = 0, deviseFacture = "USD" }: { id: string; estDirection?: boolean; reste?: number; taux?: number; /** Devise de la facture : `reste` est dans cette devise. */ deviseFacture?: DeviseFacture }) {
  const [ouvert, setOuvert] = useState(false);
  const [date, setDate] = useState(() => jourKinshasaISO());
  // Devise du paiement (2026-10-08) : en francs, montant proposé = reste × taux du jour, modifiable.
  // Facture en francs (2026-10-09) : payée en francs par défaut (le reste, sans conversion) ; en
  // dollars, montant proposé = reste ÷ taux du jour, modifiable.
  const [devise, setDevise] = useState<DevisePaiement>(deviseFacture);
  const [francs, setFrancs] = useState("");
  const [dollars, setDollars] = useState("");
  const enFC = deviseFacture === "CDF";
  const choisirDevise = (d: DevisePaiement) => {
    setDevise(d);
    if (!enFC && d === "CDF" && !francs) setFrancs(francsProposes(reste, taux));
    if (enFC && d === "USD" && !dollars) setDollars(dollarsProposes(reste, taux));
  };
  const montantManquant = (!enFC && devise === "CDF" && !((lireNombreSaisi(francs) ?? 0) > 0)) || (enFC && devise === "USD" && !((lireNombreSaisi(dollars) ?? 0) > 0));
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const confirmer = () => {
    setErreur(null);
    start(async () => {
      const r = enFC
        ? await marquerPayee(id, date, undefined, devise === "USD" ? dollars : undefined)
        : await marquerPayee(id, date, devise === "CDF" ? francs : undefined);
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
        <BasculeDevise devise={devise} onDevise={choisirDevise} taux={taux} deviseFacture={deviseFacture} />
      </div>
      {!enFC && devise === "CDF" && <SaisieFrancs francs={francs} onFrancs={setFrancs} reste={reste} taux={taux} demande={!estDirection} />}
      {enFC && devise === "USD" && <SaisieDollars dollars={dollars} onDollars={setDollars} reste={reste} taux={taux} demande={!estDirection} />}
      <BoutonValider onClick={confirmer} disabled={isPending || montantManquant}>{isPending ? "…" : estDirection ? "Confirmer" : "Envoyer la demande"}</BoutonValider>
      <BoutonNeutre onClick={() => { setOuvert(false); setErreur(null); }}>Annuler</BoutonNeutre>
      {erreur && <span className="w-full text-xs text-destructive">{erreur}</span>}
    </div>
  );
}
