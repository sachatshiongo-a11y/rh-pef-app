"use client";

import { useState } from "react";
import { retenuePourDuree } from "@/lib/prets";
import { MOIS_FR } from "@/lib/dates-fr";

const inputCls = "rounded border border-input bg-background px-2 py-1 text-sm";
const usd = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

/**
 * Formulaire d'octroi d'un prêt, avec saisie par DURÉE : « 300 $ sur 6 mois » remplit la retenue
 * mensuelle (50 $). La durée n'est PAS enregistrée — seule la retenue mensuelle l'est, car c'est
 * elle que le moteur de paie applique. Elle reste donc librement ajustable après le calcul, même
 * principe que la prime d'ancienneté.
 *
 * L'aperçu du mois de solde est indicatif : il déroule la même règle que la paie
 * (min(retenue, solde restant)) à partir de la période en cours.
 */
export function PretForm({
  action,
  periodeCourante,
}: {
  action: (formData: FormData) => void | Promise<void>;
  periodeCourante: { mois: number; annee: number };
}) {
  const [montant, setMontant] = useState("");
  const [duree, setDuree] = useState("");
  const [retenue, setRetenue] = useState("");

  const montantNum = Number(montant.replace(",", "."));
  const retenueNum = Number(retenue.replace(",", "."));

  function onDuree(v: string) {
    setDuree(v);
    const calc = retenuePourDuree(montantNum, Number(v.replace(",", ".")));
    if (calc > 0) setRetenue(String(calc));
  }

  function onMontant(v: string) {
    setMontant(v);
    const calc = retenuePourDuree(Number(v.replace(",", ".")), Number(duree.replace(",", ".")));
    if (calc > 0) setRetenue(String(calc));
  }

  // Nombre d'échéances réellement nécessaires avec la retenue retenue (qui peut avoir été ajustée
  // à la main après le calcul par durée) — puis le mois où le prêt tombera à zéro.
  const nbEcheances =
    Number.isFinite(montantNum) && montantNum > 0 && Number.isFinite(retenueNum) && retenueNum > 0
      ? Math.ceil(montantNum / retenueNum)
      : 0;
  const finIndex = nbEcheances > 0 ? periodeCourante.mois - 1 + (nbEcheances - 1) : 0;
  const moisFin = nbEcheances > 0
    ? { mois: (finIndex % 12) + 1, annee: periodeCourante.annee + Math.floor(finIndex / 12) }
    : null;

  return (
    <form action={action} className="border-t pt-3 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">Montant du prêt ($)
          <input type="number" name="montantUSD" step="0.01" min="0" required value={montant} onChange={(e) => onMontant(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-0.5">Durée (mois)
          <input type="number" step="1" min="1" value={duree} onChange={(e) => onDuree(e.target.value)} placeholder="ex. 6" className={`${inputCls} w-24`} />
        </label>
        <label className="flex flex-col gap-0.5">Retenue mensuelle ($)
          <input type="number" name="retenueMensuelleUSD" step="0.01" min="0" required value={retenue} onChange={(e) => setRetenue(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-0.5">Motif (optionnel)
          <input type="text" name="motif" placeholder="ex. avance médicale" className={inputCls} />
        </label>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
          Accorder le prêt
        </button>
      </div>

      {moisFin && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {nbEcheances} échéance(s) de {usd(retenueNum)} — soldé en {MOIS_FR[moisFin.mois - 1]} {moisFin.annee}
          {nbEcheances > 1 && montantNum % retenueNum !== 0 && (
            <> (la dernière sera ramenée à {usd(montantNum - retenueNum * (nbEcheances - 1))})</>
          )}
          . La durée n&apos;est pas enregistrée : seule la retenue mensuelle l&apos;est, et elle reste ajustable.
        </p>
      )}
    </form>
  );
}
