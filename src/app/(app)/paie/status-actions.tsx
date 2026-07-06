"use client";

import { changerStatutPaie } from "./actions";
import { prochainsEtats } from "@/lib/paie-etats";
import { BTN_VALIDER, BTN_NEUTRE } from "@/components/action-buttons";
import type { PaymentStatus, ModePaiement } from "@prisma/client";

// Libellé d'une transition « en avant » (validation / paiement).
const LABEL_AVANT: Record<PaymentStatus, string> = {
  VALIDE: "Valider",
  PAYE: "Marquer payé",
  PAS_VALIDE: "Rouvrir",
};
// Ordre des états : toute transition vers un état inférieur = réouverture.
const ORDRE: Record<PaymentStatus, number> = { PAS_VALIDE: 0, VALIDE: 1, PAYE: 2 };

const MODES_PAIEMENT: { valeur: ModePaiement; label: string }[] = [
  { valeur: "ESPECES", label: "Espèces" },
  { valeur: "VIREMENT", label: "Virement bancaire" },
  { valeur: "MOBILE_MONEY", label: "Mobile Money" },
  { valeur: "CHEQUE", label: "Chèque" },
  { valeur: "AUTRE", label: "Autre" },
];

/**
 * Boutons de transition (3 états : Pas validé → Validé → Payé, + réouverture).
 * Plus de confirmation de paiement (mode/preuve). Validation/paiement/réouverture = Admin.
 */
export function StatusActions({
  payrollLineId,
  statut,
  peutValider,
  modePaiementDefaut = "ESPECES",
}: {
  payrollLineId: string;
  statut: PaymentStatus;
  peutValider: boolean; // ADMIN
  peutPreparer?: boolean; // conservé pour compatibilité d'appel, non utilisé
  modePaiementDefaut?: ModePaiement; // pré-rempli depuis la fiche employé
}) {
  if (!peutValider) return null;
  const cibles = prochainsEtats(statut);
  if (cibles.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {cibles.map((vers) => {
        const reouverture = ORDRE[vers] < ORDRE[statut];
        return (
          <form key={vers} action={changerStatutPaie.bind(null, payrollLineId)} className="inline-flex items-center gap-1">
            <input type="hidden" name="versStatut" value={vers} />
            {/* Au paiement : moyen de paiement pré-rempli depuis la fiche, modifiable. */}
            {vers === "PAYE" && !reouverture && (
              <select
                name="modePaiement"
                defaultValue={modePaiementDefaut}
                title="Moyen de paiement"
                className="rounded border border-input bg-background px-1.5 py-1 text-xs"
              >
                {MODES_PAIEMENT.map((m) => (
                  <option key={m.valeur} value={m.valeur}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className={reouverture ? BTN_NEUTRE : BTN_VALIDER}>
              {reouverture ? "↩ Rouvrir" : `✓ ${LABEL_AVANT[vers]}`}
            </button>
          </form>
        );
      })}
    </div>
  );
}
