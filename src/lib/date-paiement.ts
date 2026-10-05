import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { MOIS_FR } from "@/lib/dates-fr";

// RÈGLE UNIQUE DE LA DATE DE PAIEMENT — source unique pour les trois chemins qui datent un
// règlement de facture fournisseur : le formulaire détaillé (« + Paiement / Avoir »),
// « Marquer payée » à l'unité et « Marquer payées » en lot. Avant, seul le formulaire détaillé
// validait quoi que ce soit ; les deux autres écrivaient `now()` (l'heure du SERVEUR, en UTC :
// entre 0 h et 1 h à Kinshasa, la facture se datait de la VEILLE) sans aucun garde-fou.
//
// Module pur (ni base, ni `server-only`) : testable sans Postgres, importé par les actions
// serveur ET (si besoin un jour) par un composant client pour une validation d'affichage —
// mais la validation qui COMPTE reste toujours celle faite ici, côté serveur.

// Nommée `jourKinshasaISO` (et non `dateDuJourKinshasa`) : une autre branche définit déjà
// `dateDuJourKinshasa(d?)` dans `src/lib/pointage-jour.ts`, qui renvoie une `Date` — même nom,
// autre type de retour, piège garanti à la fusion. Celle-ci reste une chaîne `YYYY-MM-DD`.
/** Aujourd'hui, heure de Kinshasa, en `YYYY-MM-DD`. */
export function jourKinshasaISO(maintenant: Date = new Date()): string {
  return jourCourantKinshasaISO(maintenant);
}

function commeJourISO(d: Date | string): string {
  return (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
}

/**
 * Lecture commune d'une date saisie (`YYYY-MM-DD`) pour un règlement : absente → aujourd'hui
 * (Kinshasa) ; illisible → refus ; dans le futur → refus. `nom` = « paiement » (factures) ou
 * « versement » (salaires) : les messages parlent le langage du geste.
 */
function lireJourNonFutur(saisie: string | null | undefined, maintenant: Date, nom: "paiement" | "versement"): string {
  const aujourdHui = jourKinshasaISO(maintenant);
  const s = (saisie ?? "").trim();
  if (!s) return aujourdHui;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Date de ${nom} invalide.`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error(`Date de ${nom} invalide.`);

  if (s > aujourdHui) throw new Error(`La date de ${nom} ne peut pas être dans le futur.`);
  return s;
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
  const s = lireJourNonFutur(saisie, maintenant, "paiement");
  if (dateFacture) {
    const df = commeJourISO(dateFacture);
    if (s < df) throw new Error(`La date de paiement (${s}) ne peut pas être antérieure à la date de la facture (${df}).`);
  }
  return s;
}

/**
 * DATE DE VERSEMENT D'UNE PAIE (« Marquer payé » unitaire, en lot, écran À valider) — même règle que
 * `lireDatePaiement` pour la lecture et le futur, plus la borne basse propre à la paie :
 * - absente/vide → aujourd'hui (Kinshasa) ;
 * - illisible → refus ; future → refus ;
 * - antérieure au 1er jour du mois de la paie (`paie`, si connue) → refus : on ne verse pas un salaire
 *   avant le mois qu'il rémunère.
 * `paie = null` : contrôle d'entrée d'un lot (les paies concernées ne sont connues qu'une ligne après l'autre,
 * dans la transaction, qui rappelle cette fonction avec la paie de chaque ligne).
 * Renvoie `YYYY-MM-DD`, ou jette une `Error` au message lisible.
 */
export function lireDateVersementPaie(saisie: string | null | undefined, paie: { mois: number; annee: number } | null, maintenant: Date = new Date()): string {
  const s = lireJourNonFutur(saisie, maintenant, "versement");
  if (paie) {
    const premier = `${String(paie.annee).padStart(4, "0")}-${String(paie.mois).padStart(2, "0")}-01`;
    if (s < premier) {
      const [a, m, j] = s.split("-");
      throw new Error(`La date de versement (${j}/${m}/${a}) ne peut pas être antérieure au 1er jour du mois de la paie (${MOIS_FR[paie.mois - 1]} ${paie.annee}).`);
    }
  }
  return s;
}

/** Le jour de versement (`YYYY-MM-DD`, déjà validé) en date PURE : minuit UTC, comme toute date civile stockée. */
export function jourDuVersement(jourISO: string): Date {
  return new Date(`${jourISO}T00:00:00.000Z`);
}
