/**
 * JOURS OUVRABLES — les deux sens du calcul, à un seul endroit.
 *
 * Règle de la paie et des congés (usage RDC) : le dimanche et les jours fériés ne sont pas
 * ouvrables ; le SAMEDI l'est (semaine de six jours). Toutes les dates sont manipulées en UTC à
 * minuit — c'est ainsi que les colonnes `@db.Date` reviennent de Prisma et que les `<input
 * type="date">` envoient leurs valeurs.
 *
 * Ce module ne dépend de RIEN : prévu pour être importé par les composants client (formulaire de
 * congé) comme par les actions serveur et la paie. La copie client de cette boucle dans
 * `components/champs-dates-conge.tsx` doit disparaître à son profit.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

function ensembleFeries(joursFeries: Iterable<Date | string>): Set<string> {
  return new Set([...joursFeries].map((d) => iso(d instanceof Date ? d : new Date(d))));
}

/** Vrai si ce jour compte : ni dimanche, ni férié. */
function estOuvrable(jour: Date, feries: Set<string>): boolean {
  return jour.getUTCDay() !== 0 && !feries.has(iso(jour));
}

/** Jours ouvrables entre deux dates, bornes incluses. 0 si `fin < debut`. */
export function compterJoursOuvrables(debut: Date, fin: Date, joursFeries: Iterable<Date | string> = []): number {
  const feries = ensembleFeries(joursFeries);
  let n = 0;
  const cur = new Date(debut);
  while (cur <= fin) {
    if (estOuvrable(cur, feries)) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

/**
 * La date de fin pour `jours` jours ouvrables à partir de `debut` (début inclus s'il est
 * ouvrable). La fin est le DERNIER jour compté : elle ne tombe jamais sur un dimanche ni un férié.
 * `null` si `jours` n'est pas un entier ≥ 1.
 */
export function finApresJoursOuvrables(debut: Date, jours: number, joursFeries: Iterable<Date | string> = []): Date | null {
  if (!Number.isInteger(jours) || jours < 1) return null;
  const feries = ensembleFeries(joursFeries);
  const cur = new Date(debut);
  let restants = jours;
  // Borne de sécurité : dix ans de calendrier. Les fériés sont finis, la boucle s'arrête bien
  // avant ; la borne évite qu'une entrée absurde ne tourne sans fin.
  for (let i = 0; i < 3660; i++) {
    if (estOuvrable(cur, feries)) {
      restants--;
      if (restants === 0) return new Date(cur);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return null;
}
