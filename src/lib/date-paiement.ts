import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// RÈGLE UNIQUE DE LA DATE DE PAIEMENT — source unique pour les trois chemins qui datent un
// règlement de facture fournisseur : le formulaire détaillé (« + Paiement / Avoir »),
// « Marquer payée » à l'unité et « Marquer payées » en lot. Avant, seul le formulaire détaillé
// validait quoi que ce soit ; les deux autres écrivaient `now()` (l'heure du SERVEUR, en UTC :
// entre 0 h et 1 h à Kinshasa, la facture se datait de la VEILLE) sans aucun garde-fou.
//
// Module pur (ni base, ni `server-only`) : testable sans Postgres, importé par les actions
// serveur ET (si besoin un jour) par un composant client pour une validation d'affichage —
// mais la validation qui COMPTE reste toujours celle faite ici, côté serveur.

/** Aujourd'hui, heure de Kinshasa, en `YYYY-MM-DD`. */
export function dateDuJourKinshasa(maintenant: Date = new Date()): string {
  return jourCivilKinshasa(maintenant).toISOString().slice(0, 10);
}

function commeJourISO(d: Date | string): string {
  return (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
}

/**
 * Lit et valide une date de paiement saisie (`YYYY-MM-DD`) :
 * - absente/vide → aujourd'hui (Kinshasa) ;
 * - illisible (format ou calendrier invalide) → refus ;
 * - dans le futur (après aujourd'hui à Kinshasa) → refus, une facture ne peut pas être payée demain ;
 * - antérieure à la date de la facture (si connue) → refus.
 * Renvoie la date validée en `YYYY-MM-DD`, ou jette une `Error` au message lisible par l'utilisateur.
 */
export function lireDatePaiement(saisie: string | null | undefined, dateFacture: Date | string | null | undefined, maintenant: Date = new Date()): string {
  const aujourdHui = dateDuJourKinshasa(maintenant);
  const s = (saisie ?? "").trim();
  if (!s) return aujourdHui;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Date de paiement invalide.");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error("Date de paiement invalide.");

  if (s > aujourdHui) throw new Error("La date de paiement ne peut pas être dans le futur.");

  if (dateFacture) {
    const df = commeJourISO(dateFacture);
    if (s < df) throw new Error(`La date de paiement (${s}) ne peut pas être antérieure à la date de la facture (${df}).`);
  }

  return s;
}
