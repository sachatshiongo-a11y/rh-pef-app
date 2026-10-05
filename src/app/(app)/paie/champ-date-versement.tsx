"use client";

import { jourKinshasaISO } from "@/lib/date-paiement";

/**
 * Date de versement d'une paie (« Marquer payé »), préremplie à aujourd'hui (heure de Kinshasa),
 * jamais après aujourd'hui. Même champ et même réglage que la date de paiement des factures du module
 * Stock. Ce n'est qu'une aide de saisie : la règle (illisible, future, avant le 1er du mois de la paie)
 * est appliquée par le serveur (`lireDateVersementPaie`), seule qui compte.
 *
 * Contrôlé (`value` + `onChange`, barres d'actions groupées) ou libre dans un formulaire (`name`, le
 * « Marquer payé » d'une ligne : la valeur part avec le formulaire).
 */
export function ChampDateVersement({
  value,
  onChange,
  name,
  disabled,
}: {
  value?: string;
  onChange?: (jour: string) => void;
  name?: string;
  disabled?: boolean;
}) {
  const aujourdHui = jourKinshasaISO();
  const controle = value !== undefined;
  return (
    <input
      type="date"
      name={name}
      {...(controle ? { value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value) } : { defaultValue: aujourdHui })}
      max={aujourdHui}
      disabled={disabled}
      aria-label="Date de versement"
      title="Date de versement du salaire"
      className="rounded border border-input bg-background px-1.5 py-1 text-xs"
    />
  );
}
