import { lundiDe, MOIS_FR_COURT } from "@/lib/dates-fr";

export { lundiDe };
export type JourResto = { iso: string; label: string; num: string };

const JLABEL = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Les 7 jours (lun→dim) de la semaine contenant `base`. */
export function joursSemaine(base: Date): JourResto[] {
  const lundi = lundiDe(base);
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(lundi);
    d.setUTCDate(d.getUTCDate() + i);
    return { iso: d.toISOString().slice(0, 10), label: JLABEL[i], num: `${d.getUTCDate()} ${MOIS_FR_COURT[d.getUTCMonth()]}` };
  });
}
