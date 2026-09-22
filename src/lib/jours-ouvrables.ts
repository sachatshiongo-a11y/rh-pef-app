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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE FORMULAIRE DE CONGÉ : début · jours ouvrables · fin, où le dernier champ touché entre
// « jours » et « fin » a raison. Fonction pure, testée sans rendu React : le composant
// `ChampsDatesConge` ne fait que l'appeler.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Les trois champs tels que les `<input>` les portent : `AAAA-MM-JJ` ou `""`, jours en texte. */
export type ChampsConge = { debut: string; jours: string; fin: string; dernierTouche: "jours" | "fin" | null };
export type ChampConge = "debut" | "jours" | "fin";

export const CHAMPS_CONGE_VIDES: ChampsConge = { debut: "", jours: "", fin: "", dernierTouche: null };

const dateIso = (s: string): Date | null => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const entier = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

function finDepuisJours(debut: string, jours: string, feries: Set<string>): string {
  const d = dateIso(debut);
  const n = entier(jours);
  if (!d || n === null) return "";
  const f = finApresJoursOuvrables(d, n, feries);
  return f ? iso(f) : "";
}

function joursDepuisFin(debut: string, fin: string, feries: Set<string>): string {
  const d = dateIso(debut);
  const f = dateIso(fin);
  if (!d || !f || f < d) return "";
  return String(compterJoursOuvrables(d, f, feries));
}

/**
 * Nouvel état après que l'utilisateur a touché `champ`.
 * - jours → la fin se calcule ; fin → les jours se recalculent ;
 * - début → si le dernier touché est « jours », la fin suit ; sinon, si une fin existe, les
 *   jours se recalculent ; sinon rien.
 */
export function recalculerChampsConge(etat: ChampsConge, champ: ChampConge, valeur: string, feries: Set<string>): ChampsConge {
  switch (champ) {
    case "jours":
      return { ...etat, jours: valeur, fin: finDepuisJours(etat.debut, valeur, feries), dernierTouche: "jours" };
    case "fin":
      return { ...etat, fin: valeur, jours: joursDepuisFin(etat.debut, valeur, feries), dernierTouche: "fin" };
    case "debut": {
      const suivant = { ...etat, debut: valeur };
      if (etat.dernierTouche === "jours" && etat.jours) return { ...suivant, fin: finDepuisJours(valeur, etat.jours, feries) };
      if (etat.fin) return { ...suivant, jours: joursDepuisFin(valeur, etat.fin, feries) };
      return suivant;
    }
  }
}
