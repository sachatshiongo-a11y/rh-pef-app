// RÉCEPTIONS D'UN BON DE COMMANDE — règles PURES (action, fiche du bon, tests). Audit du 10/10/2026, stock 2.
//
// Chaque ligne du bon garde sa quantité REÇUE cumulée (`LigneBonDeCommande.quantiteRecue`, somme de ses
// réceptions). Le statut du bon se calcule sur ce cumul : « Reçu partiel » tant qu'une ligne n'est pas
// entièrement reçue, « Reçu » quand TOUTES le sont — lignes libres (sans article du catalogue) comprises : leur
// réception est comptée, elle n'a simplement aucun effet sur le stock (une réception ne touche jamais au
// stock : l'entrée en stock se fait par la facture ou la liste d'achat, par la porte unique stock-positif.ts).

import Decimal from "decimal.js";

type Dec = { toString(): string } | string | number | null | undefined;
const dec = (v: Dec): Decimal => (v === null || v === undefined || String(v).trim() === "" ? new Decimal(0) : new Decimal(String(v)));

/** Une réception n'a de sens que sur un bon validé, pas encore entièrement reçu, non annulé. */
export function exigerBonReceptionnable(statut: string): void {
  if (statut === "BROUILLON") throw new Error("Ce bon de commande est un brouillon : faites-le approuver avant d'enregistrer une réception.");
  if (statut === "ANNULE") throw new Error("Ce bon de commande est annulé : aucune réception ne peut être enregistrée.");
  if (statut === "RECU") throw new Error("Ce bon de commande est déjà reçu en totalité : rien à réceptionner. (Pour corriger, changez son statut.)");
}

/**
 * Quantités reçues SAISIES (une par ligne, ids répétés additionnés) : jamais négatives, 3 décimales au plus,
 * lignes connues du bon. Les lignes à 0 ou vides sont écartées (« rien reçu » n'est pas une réception).
 */
export function lireQuantitesRecues(ligneIds: string[], quantites: number[], lignesDuBon: { id: string; designation: string }[]): Map<string, Decimal> {
  const connues = new Map(lignesDuBon.map((l) => [l.id, l.designation]));
  const recu = new Map<string, Decimal>();
  ligneIds.forEach((id, i) => {
    const q = quantites[i] ?? 0;
    if (!connues.has(id)) throw new Error("Ligne inconnue sur ce bon de commande : rechargez la page.");
    if (q < 0) throw new Error(`Quantité reçue négative pour « ${connues.get(id)} » : saisissez une quantité positive.`);
    if (q >= 1e11) throw new Error(`Quantité reçue hors limites pour « ${connues.get(id)} » : vérifiez la saisie.`);
    if (Math.round(q * 1000) / 1000 !== q) throw new Error(`Quantité reçue de « ${connues.get(id)} » : 3 décimales au plus.`);
    if (q > 0) recu.set(id, (recu.get(id) ?? new Decimal(0)).plus(q));
  });
  if (recu.size === 0) throw new Error("Renseignez au moins une quantité reçue.");
  return recu;
}

export type LigneReception = { id: string; designation: string; quantite: Dec; quantiteRecue: Dec };
export type ResultatReception = {
  /** Nouveau cumul de chaque ligne touchée par cette réception. */
  maj: { id: string; quantiteRecue: string }[];
  /** Toutes les lignes du bon (libres comprises) sont reçues en totalité. */
  complet: boolean;
  /** Lignes encore à recevoir après cette réception, avec le reste. */
  restes: { id: string; designation: string; reste: string }[];
};

/** Cumule la réception et calcule le statut : « complet » quand CHAQUE ligne a reçu au moins sa quantité commandée. */
export function appliquerReception(lignes: LigneReception[], recu: Map<string, Decimal>): ResultatReception {
  const cumul = new Map(lignes.map((l) => [l.id, dec(l.quantiteRecue).plus(recu.get(l.id) ?? 0)]));
  const restes = lignes.flatMap((l) => {
    const reste = dec(l.quantite).minus(cumul.get(l.id)!);
    return reste.gt(0) ? [{ id: l.id, designation: l.designation, reste: reste.toString() }] : [];
  });
  return {
    maj: [...recu.keys()].map((id) => ({ id, quantiteRecue: cumul.get(id)!.toString() })),
    complet: lignes.length > 0 && restes.length === 0,
    restes,
  };
}

/** Reste à recevoir d'une ligne (jamais négatif). */
export function resteARecevoir(quantite: Dec, quantiteRecue: Dec): string {
  const r = dec(quantite).minus(dec(quantiteRecue));
  return (r.gt(0) ? r : new Decimal(0)).toString();
}

/**
 * Quantité reçue À AFFICHER d'une ligne : le cumul enregistré ; à défaut (bon réceptionné avant les
 * quantités par ligne), « tout » si le bon est « Reçu », sinon null — inconnue, jamais devinée ni mise à 0.
 */
export function quantiteRecueAffichee(statutBon: string, l: { quantite: Dec; quantiteRecue: Dec }): number | null {
  if (l.quantiteRecue !== null && l.quantiteRecue !== undefined) return Number(String(l.quantiteRecue));
  return statutBon === "RECU" ? Number(String(l.quantite)) : null;
}
