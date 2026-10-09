"use client";

// Choix de la DEVISE d'un paiement de facture ($ ou FC) et annonce de la conversion — partagé par
// « Marquer payée » (liste, fiche facture, fiche fournisseur) et « Marquer payées » (lot).
// Demande de la Direction (2026-10-08) : « possibilité de payer des factures en francs ». Une facture
// garde SA devise ; versé dans l'autre devise, le montant est converti au taux du jour du paiement
// (ou de la validation, pour une demande) par LA règle des règlements (`imputation`, la même que le
// serveur) : l'écran annonce exactement ce qui sera écrit, à ce taux. Depuis le 2026-10-09, une
// facture peut être tenue en FRANCS : payée en francs, aucune conversion ; payée en dollars, dollars
// × taux du jour (`SaisieDollars`).

import { ChampNombre } from "@/components/champ-nombre";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";
import { lireNombreSaisi, versSaisie } from "@/lib/nombre";
import { dollarsPourReste, francsEnDollars, francsPourReste, imputation } from "@/lib/validations-stock/conversion-francs";
import { ajouterAuTotal, formaterMontantFacture, libelleTotal, totalVide, type DeviseFacture } from "@/lib/facture-devise";

export type DevisePaiement = "USD" | "CDF";
/** Devise versée pour un lot : « chacune dans sa devise » (aucune conversion), dollars ou francs. */
export type DeviseLot = DevisePaiement | "SA_DEVISE";

const jourMois = () => { const iso = jourKinshasaISO(); return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };

/**
 * Bascule $ / FC. Sans taux du jour (Paramètres), la devise qui exige une conversion — celle qui
 * n'est pas la devise de la facture (`deviseFacture`, dollars par défaut) — est grisée : le serveur
 * la refuserait. `saDevise` (lot) : un troisième choix, « chacune dans sa devise », sans conversion.
 */
export function BasculeDevise<D extends DeviseLot = DevisePaiement>({ devise, onDevise, taux, petit = false, deviseFacture = "USD", saDevise = false }: { devise: D; onDevise: (d: D) => void; taux: number; petit?: boolean; deviseFacture?: DeviseFacture | null; saDevise?: boolean }) {
  const cls = petit ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const choix = (d: DeviseLot, libelle: string) => {
    const conversion = d !== "SA_DEVISE" && deviseFacture !== null && d !== deviseFacture;
    const grise = d !== "SA_DEVISE" && (deviseFacture === null || conversion) && !(taux > 0);
    return (
      <button key={d} type="button" onClick={() => onDevise(d as D)} aria-pressed={devise === d} disabled={grise}
        title={d === "SA_DEVISE" ? "Chaque facture payée dans sa devise : aucune conversion" : grise ? `Taux du jour non défini (Paramètres) : paiement en ${d === "CDF" ? "francs" : "dollars"} impossible` : conversion ? `Payer en ${d === "CDF" ? "francs" : "dollars"} (1 $ = ${formaterNombre(taux)} FC)` : undefined}
        className={`${cls} ${devise === d ? "bg-primary text-primary-foreground" : "hover:bg-accent"} disabled:cursor-not-allowed disabled:opacity-50`}>{libelle}</button>
    );
  };
  return (
    <div role="group" aria-label="Devise du paiement" className="inline-flex overflow-hidden rounded-md border">
      {saDevise && choix("SA_DEVISE", "Sa devise")}
      {choix("USD", "$")}
      {choix("CDF", "FC")}
    </div>
  );
}

/** Dollars proposés pour solder un reste en francs (reste ÷ taux, au centime), en texte de saisie. */
export const dollarsProposes = (resteCDF: number, taux: number): string => (taux > 0 ? versSaisie(dollarsPourReste(resteCDF, taux)) : "");

/**
 * Montant en dollars versé sur UNE facture tenue en FRANCS (proposé = reste ÷ taux du jour,
 * modifiable) et sa confirmation : « 35,71 $ ≈ 100 000 FC au taux du 09/10 (1 $ = 2 800 FC) · reste
 * après : 0 FC ». À un demi-centime près, le paiement solde la facture (même règle que le serveur).
 */
export function SaisieDollars({ dollars, onDollars, reste, taux, petit = false, demande = false }: { dollars: string; onDollars: (v: string) => void; reste: number; taux: number; petit?: boolean; demande?: boolean }) {
  const usd = lireNombreSaisi(dollars);
  const imp = usd !== null && usd > 0 ? imputation("CDF", { devise: "USD", montant: usd }, taux > 0 ? taux : null, reste) : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <ChampNombre value={dollars} onChange={(e) => onDollars(e.target.value)} suffixe="$" aria-label="Montant payé en dollars"
        className={`rounded-md border border-input bg-background ${petit ? "px-1.5 py-1 text-xs" : "px-2 py-1.5 text-sm"} w-28 text-right`} classeConteneur="w-28" />
      <span className={`text-xs tabular-nums ${imp?.depasse ? "text-destructive" : "text-muted-foreground"}`}>
        {imp === null ? (taux > 0 ? "Saisissez le montant versé en dollars." : "Taux du jour non défini (Paramètres) : paiement en dollars impossible.") : (
          <>
            {formaterUSD(usd!)} ≈ {formaterMontantFacture(imp.impute, "CDF")} au taux du {jourMois()} (1 $ = {formaterNombre(taux)} FC)
            {imp.depasse ? ` — dépasse le reste à payer (${formaterMontantFacture(reste, "CDF")})` : ` · reste après : ${formaterMontantFacture(Math.max(0, Math.round((reste - imp.impute) * 100) / 100), "CDF")}`}
            {demande && " — indicatif : le taux du jour de la validation s'appliquera"}
          </>
        )}
      </span>
    </span>
  );
}

/**
 * Confirmation d'un LOT qui compte des factures en francs, ou payé dans une autre devise que celle
 * de ses factures : ce qui sera VERSÉ, par devise (chaque facture soldée dans sa devise).
 */
export function TotalLot({ factures, verse, taux, demande = false }: { factures: { devise: DeviseFacture; reste: number }[]; verse: DeviseLot; taux: number; demande?: boolean }) {
  const conversion = factures.some((f) => verse !== "SA_DEVISE" && verse !== f.devise);
  if (conversion && !(taux > 0)) return <span className="text-xs text-destructive">Taux du jour non défini (Paramètres) : conversion impossible.</span>;
  const total = factures.reduce((t, f) => {
    const v = verse === "SA_DEVISE" ? f.devise : verse;
    if (v === f.devise) return ajouterAuTotal(t, f.devise, f.reste);
    return ajouterAuTotal(t, v, f.devise === "USD" ? francsPourReste(f.reste, taux) : dollarsPourReste(f.reste, taux));
  }, totalVide());
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      Versé : {libelleTotal(total)}{conversion && <> au taux du {jourMois()} (1 $ = {formaterNombre(taux)} FC)</>} · chaque facture soldée dans sa devise
      {demande && conversion && " — indicatif : le taux du jour de la validation s'appliquera"}
    </span>
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
