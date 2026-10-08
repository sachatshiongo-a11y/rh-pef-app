import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";

// CHANGER LA DATE D'UNE SORTIE DE STOCK — règles pures (écran Mouvements, actions, notification).
//
// Demande de Sacha (2026-10-08) : « possibilité de changer la date d'une sortie de stock ». Une
// CORRECTION de date, pas un mouvement : ni la quantité, ni le motif, ni `Stock.quantite` ne bougent ;
// la sortie garde son id. Seules les SORTIES : la date d'une entrée (facture, réception de bon de
// commande, Liste d'achat) ou d'un ajustement de comptage est portée par son document.
//
// La date est un jour civil de Kinshasa (`AAAA-MM-JJ`), stocké en date PURE (minuit UTC de ce jour),
// comme toute date de mouvement. Jamais dans le futur : « aujourd'hui » se lit à Kinshasa.

export const MESSAGE_DATE_SORTIE_VIDE = "Choisissez la nouvelle date de la sortie.";
export const MESSAGE_DATE_SORTIE_INVALIDE = "Date invalide : choisissez un jour du calendrier (JJ/MM/AAAA).";
export const MESSAGE_SORTIES_SEULES =
  "Seules les sorties changent de date : la date d'une entrée ou d'un ajustement est portée par son document (facture, bon de commande, Liste d'achat, comptage). Rien n'a été modifié.";

/** « 03/10 » d'une date pure ou d'un jour `AAAA-MM-JJ`. */
export function jjmm(d: Date | string): string {
  const iso = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** « 03/10/2026 » d'une date pure ou d'un jour `AAAA-MM-JJ`. */
export function jjmmaaaa(d: Date | string): string {
  const iso = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Le jour `AAAA-MM-JJ` d'une date pure (minuit UTC). */
export const jourISO = (d: Date) => d.toISOString().slice(0, 10);

/** Le jour `AAAA-MM-JJ` en date PURE (minuit UTC), comme les dates de mouvement stockées. */
export const datePureDe = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Lit la nouvelle date saisie (`AAAA-MM-JJ`) : vide → refus (jamais « aujourd'hui » par défaut : on
 * corrige une date, on ne la devine pas) ; illisible ou hors calendrier (31/02) → refus ; après
 * aujourd'hui à Kinshasa → refus. Renvoie le jour validé, ou jette une `Error` au message lisible.
 */
export function lireNouvelleDateSortie(saisie: unknown, maintenant: Date = new Date()): string {
  const s = typeof saisie === "string" ? saisie.trim() : "";
  if (!s) throw new Error(MESSAGE_DATE_SORTIE_VIDE);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(MESSAGE_DATE_SORTIE_INVALIDE);
  const d = datePureDe(s);
  if (Number.isNaN(d.getTime()) || jourISO(d) !== s) throw new Error(MESSAGE_DATE_SORTIE_INVALIDE);
  const aujourdHui = jourCourantKinshasaISO(maintenant);
  if (s > aujourdHui) throw new Error(`La date d'une sortie ne peut pas être dans le futur (aujourd'hui à Kinshasa : ${jjmmaaaa(aujourdHui)}). Rien n'a été modifié.`);
  return s;
}

/** Nature lisible d'un mouvement qui n'est PAS une sortie (refus « seules les sorties »). PURE. */
export function natureNonSortie(m: { type: string; factureId?: string | null; receptionId?: string | null }): string {
  if (m.type === "AJUSTEMENT") return "ajustement de comptage";
  if (m.factureId) return "entrée par facture";
  if (m.receptionId) return "réception de bon de commande";
  return "entrée";
}

/**
 * « 03/10 → 01/10 » ; plusieurs anciennes dates : « 03/10, 04/10 → 01/10 » (au-delà de 4 : « 03/10,
 * 04/10, 05/10, 06/10… (7 dates) → 01/10 »). Dates triées, sans doublon. PURE.
 */
export function avantApres(anciennes: (Date | string)[], nouvelle: Date | string): string {
  const jours = [...new Set(anciennes.map((d) => (typeof d === "string" ? d : jourISO(d))))].sort();
  const liste = jours.length > 4 ? `${jours.slice(0, 4).map(jjmm).join(", ")}… (${jours.length} dates)` : jours.map(jjmm).join(", ");
  return `${liste} → ${jjmm(nouvelle)}`;
}

/** Noms d'une liste, bornée : « Riz, Sel, Huile et 4 autres ». PURE. */
export function nomsBornes(noms: string[], max = 6): string {
  if (noms.length <= max) return noms.join(", ");
  return `${noms.slice(0, max).join(", ")} et ${noms.length - max} autre${noms.length - max > 1 ? "s" : ""}`;
}
