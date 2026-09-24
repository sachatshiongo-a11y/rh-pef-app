"use client";

import { changerStatutPaie } from "./actions";
import { prochainsEtats } from "@/lib/paie-etats";
import { BoutonValider, BTN_NEUTRE } from "@/components/action-buttons";
import type { PaymentStatus, ModePaiement } from "@prisma/client";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import type { AvertissementPaie } from "@/lib/paie-reference";
import { messageConfirmationValidation } from "./avertissements-validation";

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
  avertissements = [],
  nom = "",
}: {
  payrollLineId: string;
  statut: PaymentStatus;
  peutValider: boolean; // ADMIN
  peutPreparer?: boolean; // conservé pour compatibilité d'appel, non utilisé
  modePaiementDefaut?: ModePaiement; // pré-rempli depuis la fiche employé
  avertissements?: AvertissementPaie[]; // montrés avant de valider, jamais bloquants
  nom?: string;
}) {
  if (!peutValider) return null;
  const cibles = prochainsEtats(statut);
  if (cibles.length === 0) return null;
  // Rien à signaler → null : bouton de validation direct, sans boîte.
  const confirmation = messageConfirmationValidation([{ nom, avertissements }]);

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
            {reouverture ? (
              <button type="submit" className={BTN_NEUTRE}>↩ Rouvrir</button>
            ) : vers === "VALIDE" && confirmation ? (
              <ConfirmSubmitButton variante="valider" message={confirmation}>{LABEL_AVANT[vers]}</ConfirmSubmitButton>
            ) : (
              <BoutonValider type="submit">{LABEL_AVANT[vers]}</BoutonValider>
            )}
          </form>
        );
      })}
    </div>
  );
}
