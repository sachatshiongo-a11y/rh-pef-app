import { MOIS_FR_COURT } from "@/lib/dates-fr";

// Message de confirmation de « Vider » (actions groupées du planning), UN SEUL pour l'ordinateur et le
// téléphone (décision de la Direction, 2026-10-08) : vider efface des affectations déjà posées, on nomme donc
// ce qui va l'être — combien de salariés, quels jours — au lieu d'un « Êtes-vous sûr ? » qui se valide sans lire.
//   « Vider 3 salariés sur 7 jours (lun. 5 → dim. 11 oct.) ? »

const JOURS_COURT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** « lun. 5 » (avec le mois : « lun. 5 oct. »). `iso` = AAAA-MM-JJ, date pure (UTC). */
function jourCourt(iso: string, avecMois: boolean): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${JOURS_COURT[d.getUTCDay()]} ${d.getUTCDate()}${avecMois ? ` ${MOIS_FR_COURT[d.getUTCMonth()]}` : ""}`;
}

/**
 * Les jours visés, en clair : les jours qui se suivent forment une plage (« lun. 5 → ven. 9 », à partir de trois),
 * les autres se listent ; le mois est dit une fois à la fin quand tous sont du même mois, sinon à chaque borne.
 * `jours` : les jours choisis, dans l'ordre du calendrier. PURE.
 */
export function libelleJoursVides(jours: readonly { iso: string }[]): string {
  const n = jours.length;
  if (n === 0) return "aucun jour";
  const mois = new Set(jours.map((j) => j.iso.slice(0, 7)));
  const memeMois = mois.size === 1;
  const un = (iso: string) => jourCourt(iso, !memeMois);
  // Plages de jours CONSÉCUTIFS (écart d'un jour civil).
  const runs: { iso: string }[][] = [];
  for (const j of jours) {
    const dernier = runs[runs.length - 1];
    const prec = dernier?.[dernier.length - 1];
    const suit = prec && Date.parse(`${j.iso}T00:00:00Z`) - Date.parse(`${prec.iso}T00:00:00Z`) === 86_400_000;
    if (suit) dernier.push(j); else runs.push([j]);
  }
  const morceaux = runs.map((r) => r.length >= 3 ? `${un(r[0].iso)} → ${un(r[r.length - 1].iso)}` : r.map((j) => un(j.iso)).join(", "));
  const fin = memeMois ? ` ${MOIS_FR_COURT[new Date(`${jours[0].iso}T00:00:00Z`).getUTCMonth()]}` : "";
  return `${n} jour${n > 1 ? "s" : ""} (${morceaux.join(", ")}${fin})`;
}

/** « Vider 3 salariés sur 7 jours (lun. 5 → dim. 11 oct.) ? » */
export function messageViderPlanning(nbSalaries: number, jours: readonly { iso: string }[]): string {
  return `Vider ${nbSalaries} salarié${nbSalaries > 1 ? "s" : ""} sur ${libelleJoursVides(jours)} ?`;
}
