"use server";

import { revalidatePath } from "next/cache";
import { actionLisible, messageDe } from "@/lib/action-lisible";
import { verifySession, requireModule } from "@/lib/auth";
import { MESSAGE_RESERVE_DIRECTION, estDirection, refuserDemande, retirerDemande, validerDemande } from "@/lib/validations-stock/demandes";

// Décisions de la Direction sur les demandes de l'espace Stock (paiement de facture, réconciliation,
// modification d'article). Une action serveur est un point d'entrée HTTP à part entière : elle ne
// passe par AUCUN layout ni par le bouton qui l'appelle. D'où la garde « Direction » ICI, côté
// serveur, en plus de celle de `validerDemande`/`refuserDemande` (défense en profondeur).

async function gardeDirection() {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!estDirection(user)) throw new Error(MESSAGE_RESERVE_DIRECTION);
  return user;
}

function rafraichir() {
  revalidatePath("/stock", "layout"); // compteur du menu, factures, inventaire, archives
}

export type BilanDecision = { traitees: string[]; echecs: { id: string; erreur: string }[] };

const uniques = (ids: string[]) => [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(Boolean);

/**
 * Valide les demandes sélectionnées, une par une (chacune dans SA transaction : une demande périmée
 * n'empêche pas les autres d'aboutir, et elle est nommée dans le bilan). `dates` : date de paiement
 * corrigée par la Direction, par demande (facultatif).
 */
export const validerDemandes = actionLisible(async (ids: string[], dates: Record<string, string> = {}): Promise<BilanDecision> => {
  const user = await gardeDirection();
  const bilan: BilanDecision = { traitees: [], echecs: [] };
  for (const id of uniques(ids)) {
    try {
      await validerDemande(user, id, { date: typeof dates?.[id] === "string" ? dates[id] : undefined });
      bilan.traitees.push(id);
    } catch (e) {
      bilan.echecs.push({ id, erreur: messageDe(e) });
    }
  }
  rafraichir();
  return bilan;
});

/** Refuse les demandes sélectionnées, avec UN motif (obligatoire) pour toutes. */
export const refuserDemandes = actionLisible(async (ids: string[], motif: string): Promise<BilanDecision> => {
  const user = await gardeDirection();
  if (String(motif ?? "").trim().length < 3) throw new Error("Indiquez le motif du refus.");
  const bilan: BilanDecision = { traitees: [], echecs: [] };
  for (const id of uniques(ids)) {
    try {
      await refuserDemande(user, id, motif);
      bilan.traitees.push(id);
    } catch (e) {
      bilan.echecs.push({ id, erreur: messageDe(e) });
    }
  }
  rafraichir();
  return bilan;
});

/** Le demandeur retire sa propre demande tant qu'elle est en attente. */
export const retirerMaDemande = actionLisible(async (id: string): Promise<void> => {
  const user = await verifySession();
  requireModule(user, "stock");
  await retirerDemande(user, String(id));
  rafraichir();
});
