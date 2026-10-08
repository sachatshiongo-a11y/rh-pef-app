// Semaines (lundi → dimanche) de la période affichée dans Présences & heures — fonctions PURES.
// Dates pures AAAA-MM-JJ calculées en UTC : aucun fuseau. « Aujourd'hui » est TOUJOURS fourni par
// l'appelant (jour civil de Kinshasa, `jourCourantKinshasaISO`) : ce module ne lit jamais l'horloge.
//
// La grille ne porte que les jours du mois de travail (clés `${employé}_${jour}`) : une semaine à
// cheval sur deux mois garde ses jours « hors période » en grisé, non saisissables ici.

export type SemaineAffichee = {
  /** Lundi de la semaine, AAAA-MM-JJ (peut tomber dans le mois précédent). */
  lundi: string;
  /** Les 7 dates de la semaine, lundi → dimanche. */
  isos: string[];
  /** Pour chacun des 7 jours : le numéro du jour dans le mois de la période, ou null s'il est hors période. */
  jours: (number | null)[];
};

const MS_JOUR = 86_400_000;
const enIso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Lundi (AAAA-MM-JJ) de la semaine qui contient la date donnée. */
export function lundiDeIso(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const rang = (new Date(t).getUTCDay() + 6) % 7; // lundi = 0
  return enIso(t - rang * MS_JOUR);
}

/**
 * Les semaines (lundi → dimanche) qui couvrent le mois `mois` (1-12) de `annee`, dans l'ordre.
 * `nbJours` (facultatif) borne la période aux `nbJours` premiers jours du mois.
 */
export function semainesDuMois(annee: number, mois: number, nbJours: number = new Date(Date.UTC(annee, mois, 0)).getUTCDate()): SemaineAffichee[] {
  const premier = `${annee}-${String(mois).padStart(2, "0")}-01`;
  const dernier = `${annee}-${String(mois).padStart(2, "0")}-${String(nbJours).padStart(2, "0")}`;
  const semaines: SemaineAffichee[] = [];
  for (let t = Date.parse(`${lundiDeIso(premier)}T00:00:00Z`); enIso(t) <= dernier; t += 7 * MS_JOUR) {
    const isos = Array.from({ length: 7 }, (_, i) => enIso(t + i * MS_JOUR));
    semaines.push({
      lundi: isos[0],
      isos,
      jours: isos.map((iso) => (iso >= premier && iso <= dernier ? Number(iso.slice(8, 10)) : null)),
    });
  }
  return semaines;
}

/**
 * Rang de la semaine à ouvrir : celle d'aujourd'hui si elle fait partie de la période ; sinon la
 * première (période à venir) ou la dernière (période passée).
 */
export function semaineParDefaut(semaines: SemaineAffichee[], aujourdhui: string): number {
  const i = semaines.findIndex((s) => aujourdhui >= s.isos[0] && aujourdhui <= s.isos[6]);
  if (i >= 0) return i;
  if (semaines.length > 0 && aujourdhui > semaines[semaines.length - 1].isos[6]) return semaines.length - 1;
  return 0;
}

/** Rang de la semaine qui contient le jour `jour` (numéro dans le mois), ou 0. */
export function semaineDuJour(semaines: SemaineAffichee[], jour: number): number {
  const i = semaines.findIndex((s) => s.jours.includes(jour));
  return i >= 0 ? i : 0;
}

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 5 → 11 octobre 2026 », « 28 sept. → 4 oct. 2026 » : titre d'une semaine. */
export function libelleSemaine(s: SemaineAffichee): string {
  const [a1, m1, j1] = s.isos[0].split("-").map(Number);
  const [a2, m2, j2] = s.isos[6].split("-").map(Number);
  const longs = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" });
  if (m1 === m2) return `${j1} → ${j2} ${longs(m2)} ${a2}`;
  if (a1 === a2) return `${j1} ${MOIS_COURTS[m1 - 1]} → ${j2} ${MOIS_COURTS[m2 - 1]} ${a2}`;
  return `${j1} ${MOIS_COURTS[m1 - 1]} ${a1} → ${j2} ${MOIS_COURTS[m2 - 1]} ${a2}`;
}
