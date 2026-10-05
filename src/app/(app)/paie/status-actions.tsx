"use client";

import { changerStatutPaie } from "./actions";
import { prochainsEtatsPour } from "@/lib/paie-etats";
import { BoutonValider, BTN_NEUTRE } from "@/components/action-buttons";
import type { PaymentStatus, ModePaiement, Role } from "@prisma/client";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import type { AvertissementPaie } from "@/lib/paie-reference";
import { messageConfirmationValidation } from "./avertissements-validation";
import { ChampDateVersement } from "./champ-date-versement";

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

/** Ce que la RH lit à la place d'un bouton sur une ligne que la Direction n'a pas encore validée. */
export const EN_ATTENTE_DIRECTION = "En attente de validation par la Direction";

/**
 * Boutons de transition (3 états : Pas validé → Validé → Payé, + réouverture). Les boutons d'une
 * ligne sont ceux que le rôle peut réellement faire (`prochainsEtatsPour`, la règle du serveur) :
 * Direction = valider, payer, rouvrir, annuler le paiement ; RH = « Marquer payé » sur une ligne
 * validée seulement (décision du 2026-10-01). Les autres rôles n'ont aucun bouton.
 */
export function StatusActions({
  payrollLineId,
  statut,
  role,
  modePaiementDefaut = "ESPECES",
  avertissements = [],
  nom = "",
  jeton,
}: {
  payrollLineId: string;
  statut: PaymentStatus;
  role: Role; // le rôle du compte : décide des boutons (même règle que l'action serveur)
  modePaiementDefaut?: ModePaiement; // pré-rempli depuis la fiche employé
  avertissements?: AvertissementPaie[]; // montrés avant de valider, jamais bloquants
  nom?: string;
  /** Montants affichés (paie-jeton.ts) : renvoyés à la validation, qui refuse une ligne recalculée depuis. */
  jeton?: string;
}) {
  const cibles = prochainsEtatsPour(role, statut);
  if (cibles.length === 0) {
    // La RH voit pourquoi elle ne peut pas encore payer (libellé, jamais un bouton grisé muet).
    return role === "MANAGER" && statut === "PAS_VALIDE" ? <span className="text-xs text-muted-foreground">{EN_ATTENTE_DIRECTION}</span> : null;
  }
  // Rien à signaler → null : bouton de validation direct, sans boîte.
  const confirmation = messageConfirmationValidation([{ nom, avertissements }]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {cibles.map((vers) => {
        const reouverture = ORDRE[vers] < ORDRE[statut];
        return (
          <form key={vers} action={changerStatutPaie.bind(null, payrollLineId)} className="inline-flex items-center gap-1">
            <input type="hidden" name="versStatut" value={vers} />
            {jeton && <input type="hidden" name="jeton" value={jeton} />}
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
            {/* Date de versement : aujourd'hui par défaut, jamais future (le serveur revérifie). */}
            {vers === "PAYE" && !reouverture && <ChampDateVersement name="dateVersement" />}
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
