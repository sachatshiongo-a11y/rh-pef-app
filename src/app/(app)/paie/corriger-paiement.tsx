"use client";

import { useState } from "react";
import type { ModePaiement } from "@prisma/client";
import { FormulaireGarde } from "@/components/formulaire-garde";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { CLASSES_NEUTRE } from "@/components/action-buttons";
import { estErreur } from "@/lib/action-lisible";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { MODES_PAIEMENT, MOTIF_CORRECTION_MAX } from "@/lib/correction-paiement";
import { corrigerPaiementBulletin } from "./correction-paiement-actions";

const champ = "w-full rounded border border-input bg-background px-2 py-1 text-xs";

/**
 * « CORRIGER LE PAIEMENT » d'un bulletin PAYÉ (Direction seule, décision du 2026-10-12) : la date de versement et le moyen
 * de paiement, de n'importe quel mois — c'est ici, sur la fiche du salarié (onglet Paie, tous les bulletins payés), que se
 * retrouve un paiement d'un mois passé. Le motif est obligatoire. L'état, les montants et le taux restent ce qu'ils sont.
 * Ce n'est qu'une aide de saisie : le serveur revérifie le rôle, la date, le moyen et le motif (correction-paiement-actions.ts).
 */
export function CorrigerPaiement({ payrollLineId, datePaiement, modePaiement, nomDocument }: {
  payrollLineId: string;
  /** Jour de versement enregistré (`YYYY-MM-DD`), ou null s'il n'a jamais été renseigné. */
  datePaiement: string | null;
  modePaiement: ModePaiement | null;
  /** « Septembre 2026 » : pour le nom accessible du bouton. */
  nomDocument: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const aujourdHui = jourKinshasaISO();
  return (
    <div className="mt-1">
      <button
        type="button"
        className={CLASSES_NEUTRE}
        aria-expanded={ouvert}
        aria-label={`Corriger le paiement — ${nomDocument}`}
        onClick={() => setOuvert((o) => !o)}
      >
        Corriger le paiement
      </button>
      {ouvert && (
        <FormulaireGarde
          reinitialiser={false}
          className="mt-2 w-60 space-y-2 rounded-md border bg-card p-2"
          action={async (donnees) => {
            const r = await corrigerPaiementBulletin(payrollLineId, donnees);
            if (!estErreur(r)) setOuvert(false);
            return r;
          }}
        >
          <label className="block text-[11px] text-muted-foreground">
            Date de versement
            <input type="date" name="datePaiement" required defaultValue={datePaiement ?? aujourdHui} max={aujourdHui} className={champ} />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Moyen de paiement
            <select name="modePaiement" required defaultValue={modePaiement ?? ""} className={champ}>
              {modePaiement === null && <option value="" disabled>— choisir —</option>}
              {MODES_PAIEMENT.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Motif (obligatoire)
            <textarea name="motif" required maxLength={MOTIF_CORRECTION_MAX} rows={2} className={champ} />
          </label>
          <BoutonEnvoi className={CLASSES_NEUTRE}>Enregistrer la correction</BoutonEnvoi>
        </FormulaireGarde>
      )}
    </div>
  );
}
