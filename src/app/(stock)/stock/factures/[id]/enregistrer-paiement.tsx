"use client";

import { useState, useTransition } from "react";
import { enregistrerPaiement } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { BoutonValider } from "@/components/action-buttons";
import { ChampNombre } from "@/components/champ-nombre";
import { lireNombreSaisi, versSaisie } from "@/lib/nombre";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";
import { imputation } from "@/lib/validations-stock/conversion-francs";
import { formaterMontantFacture, type DeviseFacture } from "@/lib/facture-devise";

const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

/**
 * Formulaire « Enregistrer un paiement / avoir » (total ou partiel, USD ou CDF) — replié derrière un
 * bouton. `reste` est dans la devise de la facture (`deviseFacture`, dollars par défaut) ; le montant
 * versé peut être dans l'autre devise, converti au taux du jour par LA règle du serveur (`imputation`).
 */
export function EnregistrerPaiement({ factureId, reste, taux, estDirection = true, deviseFacture = "USD" }: { factureId: string; reste: number; taux: number; estDirection?: boolean; deviseFacture?: DeviseFacture }) {
  const [ouvert, setOuvert] = useState(false);
  const [type, setType] = useState<"PAIEMENT" | "AVOIR">("PAIEMENT");
  const [devise, setDevise] = useState<"USD" | "CDF">(deviseFacture);
  const [montant, setMontant] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  if (reste <= 0.001) return null;

  const submit = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      const r = await enregistrerPaiement(factureId, fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setOuvert(false); setMontant("");
    });
  };

  if (!ouvert) {
    // Hors Direction, le formulaire DEMANDE le règlement (validé ensuite par la Direction).
    return <BoutonValider onClick={() => setOuvert(true)}>{estDirection ? "+ Paiement / Avoir" : "+ Demander un paiement / avoir"}</BoutonValider>;
  }

  const saisi = lireNombreSaisi(montant); // null = vide ou illisible (le champ le dit en rouge)
  // Ce que le versement retire du reste, DANS LA DEVISE DE LA FACTURE : LA règle des règlements
  // (celle du serveur) — converti au taux du jour s'il est versé dans l'autre devise.
  const imp = saisi !== null && saisi > 0 ? imputation(deviseFacture, { devise, montant: saisi }, taux > 0 ? taux : null, reste) : null;
  const fm = (n: number) => formaterMontantFacture(n, deviseFacture);
  const iso = jourKinshasaISO();

  return (
    <form action={submit} className="flex w-full flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
      {erreur && <p className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">Type
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <button type="button" onClick={() => setType("PAIEMENT")} className={`px-3 py-1.5 ${type === "PAIEMENT" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Paiement</button>
          <button type="button" onClick={() => setType("AVOIR")} className={`px-3 py-1.5 ${type === "AVOIR" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Avoir</button>
        </div>
        <input type="hidden" name="type" value={type} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">Devise
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <button type="button" onClick={() => setDevise("USD")} className={`px-3 py-1.5 ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>USD</button>
          <button type="button" onClick={() => setDevise("CDF")} className={`px-3 py-1.5 ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>CDF (FC)</button>
        </div>
        <input type="hidden" name="devise" value={devise} />
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Montant ({devise}) *
        <ChampNombre name="montant" value={montant} onChange={(e) => setMontant(e.target.value)} required autoFocus suffixe={devise === "USD" ? "$" : "FC"}
          placeholder={devise === deviseFacture ? versSaisie(Math.round(reste * 100) / 100) : !(taux > 0) ? "" : devise === "CDF" ? versSaisie(Math.round(reste * taux)) : versSaisie(Math.round((reste / taux) * 100) / 100)}
          className={`${inp} w-32 text-right`} classeConteneur="w-32" />
      </label>
      {saisi !== null && saisi > 0 && devise !== deviseFacture && imp === null && <span className="pb-2 text-xs text-destructive">Taux du jour non défini (Paramètres) : conversion impossible.</span>}
      {imp !== null && (
        <span className={`pb-2 text-xs tabular-nums ${imp.depasse ? "text-destructive" : "text-muted-foreground"}`}>
          {imp.converti && <>{devise === "CDF" ? formaterFC(saisi!) : formaterUSD(saisi!)} ≈ {fm(imp.impute)} au taux du {iso.slice(8, 10)}/{iso.slice(5, 7)} (1 $ = {formaterNombre(taux)} FC){!estDirection && " — indicatif : le taux du jour de la validation s'appliquera"} · </>}
          {imp.depasse ? `dépasse le reste à payer (${fm(reste)})` : `reste après : ${fm(Math.max(0, Math.round((reste - imp.impute) * 100) / 100))}`}
        </span>
      )}

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date
        <input name="date" type="date" defaultValue={jourKinshasaISO()} max={jourKinshasaISO()} className={inp} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Mode
        <input name="modePaiement" placeholder="Espèces, virement…" className={`${inp} w-32`} />
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">{type === "AVOIR" ? "Motif de l'avoir *" : "Note"}
        <input name="note" required={type === "AVOIR"} placeholder={type === "AVOIR" ? "ex. retour marchandise abîmée" : "ex. acompte livraison"} className={inp} />
      </label>
      <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : estDirection ? "Enregistrer" : "Envoyer la demande"}</button>
      <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
    </form>
  );
}
