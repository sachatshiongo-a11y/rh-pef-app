export type JourResto = { iso: string; label: string; num: string };

const JLABEL = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Lundi (UTC) de la semaine contenant `d`. */
export function lundiDe(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** Les 7 jours (lun→dim) de la semaine contenant `base`. */
export function joursSemaine(base: Date): JourResto[] {
  const lundi = lundiDe(base);
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(lundi);
    d.setUTCDate(d.getUTCDate() + i);
    return { iso: d.toISOString().slice(0, 10), label: JLABEL[i], num: `${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}` };
  });
}
