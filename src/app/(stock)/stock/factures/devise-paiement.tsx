"use client";

// Choix de la DEVISE d'un paiement de facture ($ ou FC) et annonce de la conversion — partagé par
// « Marquer payée » (liste, fiche facture, fiche fournisseur) et « Marquer payées » (lot).
// Demande de la Direction (2026-10-08) : « possibilité de payer des factures en francs ». La facture
// reste tenue en dollars ; en francs, le montant versé est converti au taux du jour du paiement (ou
// de la validation, pour une demande) par LA conversion des règlements (`francsEnDollars`, la même
// que le serveur) : l'écran annonce exactement ce qui sera écrit, à ce taux.

import { ChampNombre } from "@/components/champ-nombre";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";
import { lireNombreSaisi, versSaisie } from "@/lib/nombre";
import { francsEnDollars, francsPourReste } from "@/lib/validations-stock/conversion-francs";

export type DevisePaiement = "USD" | "CDF";

const jourMois = () => { const iso = jourKinshasaISO(); return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };

/** Bascule $ / FC. Sans taux du jour (Paramètres), le franc est grisé — le serveur le refuserait. */
export function BasculeDevise({ devise, onDevise, taux, petit = false }: { devise: DevisePaiement; onDevise: (d: DevisePaiement) => void; taux: number; petit?: boolean }) {
  const cls = petit ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div role="group" aria-label="Devise du paiement" className="inline-flex overflow-hidden rounded-md border">
      <button type="button" onClick={() => onDevise("USD")} aria-pressed={devise === "USD"} className={`${cls} ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>$</button>
      <button type="button" onClick={() => onDevise("CDF")} aria-pressed={devise === "CDF"} disabled={!(taux > 0)}
        title={taux > 0 ? `Payer en francs (1 $ = ${formaterNombre(taux)} FC)` : "Taux du jour non défini (Paramètres) : paiement en francs impossible"}
        className={`${cls} ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"} disabled:cursor-not-allowed disabled:opacity-50`}>FC</button>
    </div>
  );
}

/** Francs proposés pour solder un reste (reste × taux, au franc), en texte de saisie. */
export const francsProposes = (resteUSD: number, taux: number): string => (taux > 0 ? versSaisie(francsPourReste(resteUSD, taux)) : "");

/**
 * Montant en francs d'UNE facture (proposé = reste × taux du jour, modifiable) et sa confirmation :
 * « 280 000 FC ≈ 100,00 $ au taux du 08/10 (1 $ = 2 800 FC) · reste après : 0,00 $ ».
 */
export function SaisieFrancs({ francs, onFrancs, reste, taux, petit = false, demande = false }: { francs: string; onFrancs: (v: string) => void; reste: number; taux: number; petit?: boolean; demande?: boolean }) {
  const fc = lireNombreSaisi(francs);
  const usd = fc !== null && fc > 0 && taux > 0 ? francsEnDollars(fc, taux) : null;
  const depasse = usd !== null && usd > reste + 0.009;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <ChampNombre value={francs} onChange={(e) => onFrancs(e.target.value)} suffixe="FC" aria-label="Montant payé en francs"
        className={`rounded-md border border-input bg-background ${petit ? "px-1.5 py-1 text-xs" : "px-2 py-1.5 text-sm"} w-32 text-right`} classeConteneur="w-32" />
      <span className={`text-xs tabular-nums ${depasse ? "text-destructive" : "text-muted-foreground"}`}>
        {usd === null ? "Saisissez le montant versé en francs." : (
          <>
            {formaterFC(fc!)} ≈ {formaterUSD(usd)} au taux du {jourMois()} (1 $ = {formaterNombre(taux)} FC)
            {depasse ? ` — dépasse le reste à payer (${formaterUSD(reste)})` : ` · reste après : ${formaterUSD(Math.max(0, Math.round((reste - usd) * 100) / 100))}`}
            {demande && " — indicatif : le taux du jour de la validation s'appliquera"}
          </>
        )}
      </span>
    </span>
  );
}

/** Confirmation d'un LOT payé en francs : chaque facture soldée par reste × taux francs. */
export function TotalLotFrancs({ restes, taux, demande = false }: { restes: number[]; taux: number; demande?: boolean }) {
  if (!(taux > 0)) return <span className="text-xs text-destructive">Taux du jour non défini (Paramètres) : paiement en francs impossible.</span>;
  const fc = restes.reduce((t, r) => t + francsPourReste(r, taux), 0);
  const usd = restes.reduce((t, r) => t + francsEnDollars(francsPourReste(r, taux), taux), 0);
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {formaterFC(fc)} ≈ {formaterUSD(usd)} au taux du {jourMois()} (1 $ = {formaterNombre(taux)} FC) · chaque facture soldée, reste après : {formaterUSD(0)}
      {demande && " — indicatif : le taux du jour de la validation s'appliquera"}
    </span>
  );
}
