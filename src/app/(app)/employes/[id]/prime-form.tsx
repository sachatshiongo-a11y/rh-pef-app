"use client";

import { useState } from "react";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Formulaire d'ajout de prime (saisie manuelle) avec assistance pour la prime d'ancienneté :
 * quand on choisit « Prime d'ancienneté », le montant suggéré (salaire de base × taux légal) est
 * pré-rempli et le libellé enregistré devient « Prime d'ancienneté (X %) ». Le montant reste
 * librement ajustable — rien n'est calculé automatiquement à la paie.
 */
export function PrimeForm({
  action,
  types,
  salaireBase,
  tauxAnciennete,
}: {
  action: (formData: FormData) => void | Promise<void>;
  types: string[];
  salaireBase: number;
  tauxAnciennete: number; // % (0 si moins de 3 ans d'ancienneté)
}) {
  const [type, setType] = useState(types[0]);
  const [montant, setMontant] = useState("");
  const [pourcentage, setPourcentage] = useState("");

  const estAnciennete = type === "Prime d'ancienneté";
  const suggestion = tauxAnciennete > 0 ? round2(salaireBase * (tauxAnciennete / 100)) : 0;
  // Libellé finalement enregistré : on précise le taux pour la prime d'ancienneté.
  const nomFinal =
    estAnciennete && tauxAnciennete > 0 ? `Prime d'ancienneté (${tauxAnciennete} %)` : type;

  function onType(v: string) {
    setType(v);
    if (v === "Prime d'ancienneté" && suggestion > 0) {
      setMontant(String(suggestion));
      setPourcentage("");
    }
  }

  // Saisie en pourcentage du salaire de base : convertie en montant à la frappe. C'est le MONTANT
  // qui est enregistré et fait foi ; le taux n'est gardé qu'en traçabilité — rien n'est recalculé
  // à la paie, exactement comme la prime d'ancienneté.
  function onPourcentage(v: string) {
    setPourcentage(v);
    const pct = Number(v.replace(",", "."));
    if (Number.isFinite(pct) && pct > 0) setMontant(String(round2(salaireBase * (pct / 100))));
  }

  return (
    <form action={action} className="rounded-lg border p-3">
      <p className="mb-2 text-sm font-medium">Appliquer une prime</p>
      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="nom" value={nomFinal} />
        <select
          value={type}
          onChange={(e) => onType(e.target.value)}
          className="min-w-52 flex-1 rounded border border-input bg-background px-2 py-1 text-sm"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          name="pourcentageBase"
          type="number"
          step="0.01"
          min="0"
          value={pourcentage}
          onChange={(e) => onPourcentage(e.target.value)}
          placeholder="% base"
          aria-label="Pourcentage du salaire de base"
          className="w-24 rounded border border-input bg-background px-2 py-1 text-sm"
        />
        <input
          name="montantUSD"
          type="number"
          step="0.01"
          min="0"
          value={montant}
          onChange={(e) => setMontant(e.target.value)}
          placeholder="Montant $"
          required
          className="w-28 rounded border border-input bg-background px-2 py-1 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
        >
          Ajouter
        </button>
      </div>
      <input
        name="motif"
        placeholder="Raison de la majoration (optionnel)"
        className="mt-2 w-full rounded border border-input bg-background px-2 py-1 text-sm"
      />
      {pourcentage !== "" && !estAnciennete && (
        <p className="mt-1 text-xs text-muted-foreground">
          {pourcentage} % de {round2(salaireBase).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $ — montant ajustable, c&apos;est lui qui est enregistré.
        </p>
      )}
      {estAnciennete && (
        <p className="mt-1 text-xs text-muted-foreground">
          {tauxAnciennete > 0
            ? `Suggestion légale : ${tauxAnciennete} % du salaire de base (${round2(salaireBase).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $) = ${suggestion.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $ — ajustable.`
            : "Ancienneté inférieure à 3 ans : aucune prime d'ancienneté légale due (barème à valider)."}
        </p>
      )}
    </form>
  );
}
