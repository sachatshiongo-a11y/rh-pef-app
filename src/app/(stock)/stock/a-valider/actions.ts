"use server";

import { revalidatePath } from "next/cache";
import { actionLisible, messageDe } from "@/lib/action-lisible";
import { verifySession, requireModule } from "@/lib/auth";
import { MESSAGE_RESERVE_DIRECTION, estDirection, refuserDemande, retirerDemande, validerDemande, type MotifValidation } from "@/lib/validations-stock/demandes";

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

/** Version vue à l'écran (jeton `updatedAt`) : obligatoire — on ne décide que de ce qu'on a vu. */
const MESSAGE_SANS_VERSION = "Version de la demande inconnue : rechargez la page avant de décider.";
const versionDe = (versions: Record<string, string> | undefined, id: string) => (typeof versions?.[id] === "string" && versions[id] ? versions[id] : null);

/**
 * Valide les demandes sélectionnées, une par une (chacune dans SA transaction : une demande périmée
 * n'empêche pas les autres d'aboutir, et elle est nommée dans le bilan). `dates` : date de paiement
 * corrigée par la Direction, par demande (facultatif). `motifs` : motif choisi pour une ancienne
 * demande de SORTIE (obligatoire pour elle depuis le 2026-10-07). `versions` : la version de chaque demande
 * telle que l'écran l'a affichée — une demande retouchée depuis est refusée (« rechargez »).
 */
export const validerDemandes = actionLisible(async (ids: string[], dates: Record<string, string> = {}, versions: Record<string, string> = {}, motifs: Record<string, MotifValidation> = {}): Promise<BilanDecision> => {
  const user = await gardeDirection();
  const bilan: BilanDecision = { traitees: [], echecs: [] };
  for (const id of uniques(ids)) {
    const version = versionDe(versions, id);
    if (!version) { bilan.echecs.push({ id, erreur: MESSAGE_SANS_VERSION }); continue; }
    try {
      const m = motifs?.[id];
      const motif = m && typeof m === "object" ? { categorie: String(m.categorie ?? ""), raison: typeof m.raison === "string" ? m.raison : null } : undefined;
      await validerDemande(user, id, { date: typeof dates?.[id] === "string" ? dates[id] : undefined, version, motif });
      bilan.traitees.push(id);
    } catch (e) {
      bilan.echecs.push({ id, erreur: messageDe(e) });
    }
  }
  rafraichir();
  return bilan;
});

/** Refuse les demandes sélectionnées, avec UN motif (obligatoire) pour toutes. */
export const refuserDemandes = actionLisible(async (ids: string[], motif: string, versions: Record<string, string> = {}): Promise<BilanDecision> => {
  const user = await gardeDirection();
  if (String(motif ?? "").trim().length < 3) throw new Error("Indiquez le motif du refus.");
  const bilan: BilanDecision = { traitees: [], echecs: [] };
  for (const id of uniques(ids)) {
    const version = versionDe(versions, id);
    if (!version) { bilan.echecs.push({ id, erreur: MESSAGE_SANS_VERSION }); continue; }
    try {
      await refuserDemande(user, id, motif, version);
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
