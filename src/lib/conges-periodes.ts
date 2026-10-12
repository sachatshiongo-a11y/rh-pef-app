// LES PÉRIODES SANS CONGÉS D'UN SALARIÉ — module PUR (ni base, ni React), décision de la Direction du 2026-10-12
// n°2 : « un stagiaire passé en CDI : faut corriger ».
//
// Avant, le statut « sans congés » (stage, intérim) se lisait sur le contrat ACTUEL de la fiche et valait pour
// toutes les années passées : un stagiaire devenu CDI n'avait plus aucun jour, même pour ses mois de CDI ; un
// CDI repassé en stage gardait, à tort, ses années de CDI sans congés.
//
// RÈGLES (à relire avec la Direction si l'une ne convient pas) :
//  1. Chaque JOUR relève du contrat qui le couvre : celui dont la date de début est la plus récente parmi ceux
//     qui commencent au plus tard ce jour-là et ne sont pas finis (date de fin vide ou ≥ ce jour). Un contrat
//     « transformé » (CDD devenu CDI) est donc relayé par le suivant, sans que sa date de fin soit renseignée.
//  2. Un jour couvert par un STAGE ou un INTÉRIM n'ouvre aucun droit ; CDI, CDD et JOURNALIER en ouvrent.
//  3. TROU (jour couvert par aucun contrat — CDD échu avant le contrat suivant, historique saisi tard) : le jour
//     reste au régime du contrat PRÉCÉDENT ; avant le tout premier contrat, au régime de ce premier contrat. Un
//     trou ne retire donc jamais un droit qu'on avait la veille, et n'en crée jamais un qu'on n'avait pas.
//     Le trou est signalé à l'écran (`trousDeContrat`) : l'outil signale, la Direction tranche.
//  4. Sans AUCUN contrat enregistré, le type de la fiche (`Employee.contrat`) vaut pour toute la période (c'est
//     l'ancien comportement, conservé pour les fiches sans historique).
//  5. MOIS PARTIEL : un mois (de date à date, comme l'ancienneté) n'ouvre droit à ses 1,5 j que si TOUS ses jours
//     sont en régime « avec congés » — voir `moisOuvreDroit`. Stage jusqu'au 15 mars puis CDI : mars n'acquiert
//     rien, avril acquiert. Un mois révolu s'acquiert entier ou pas du tout : jamais de prorata de jours.

/** Un contrat de ce type n'acquiert pas de congés payés (stage, intérim). */
export const typeSansConges = (type: string | null | undefined): boolean => type === "STAGE" || type === "INTERIM";

const JOUR = 86_400_000;
const t = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export type ContratPeriode = { type: string; dateDebut: Date; dateFin: Date | null };
/** Plage de jours (bornes incluses) ; `fin` null = sans fin. */
export type PeriodeSansConges = { debut: Date | null; fin: Date | null; type: string };

type Segment = { debut: number; fin: number; type: string; trou: boolean };

/** Régime de chaque tronçon de la vie professionnelle : contrats, trous (type du précédent), tête (type du premier). */
function segments(contrats: ContratPeriode[]): Segment[] {
  const cs = contrats
    .map((c, i) => ({ type: c.type, debut: t(new Date(c.dateDebut)), fin: c.dateFin ? t(new Date(c.dateFin)) : Infinity, i }))
    .sort((a, b) => a.debut - b.debut || a.i - b.i);
  if (cs.length === 0) return [];
  const bornes = [...new Set(cs.flatMap((c) => [c.debut, c.fin === Infinity ? NaN : c.fin + JOUR]).filter((x) => Number.isFinite(x)))].sort((a, b) => a - b);
  const typeAuJour = (jour: number): { type: string; trou: boolean } => {
    const couvrant = cs.filter((c) => c.debut <= jour && c.fin >= jour);
    if (couvrant.length > 0) return { type: couvrant[couvrant.length - 1].type, trou: false }; // début le plus récent, à égalité le dernier saisi
    const avant = cs.filter((c) => c.debut <= jour);
    return { type: (avant.length > 0 ? avant[avant.length - 1] : cs[0]).type, trou: avant.length > 0 }; // tête de période : pas un trou
  };
  const out: Segment[] = [];
  const starts = [-Infinity, ...bornes];
  for (let k = 0; k < starts.length; k++) {
    const debut = starts[k];
    const fin = k + 1 < starts.length ? starts[k + 1] - JOUR : Infinity;
    const ref = debut === -Infinity ? cs[0].debut - JOUR : debut;
    const r = typeAuJour(ref);
    const prec = out[out.length - 1];
    if (prec && prec.type === r.type && prec.trou === r.trou) prec.fin = fin;
    else out.push({ debut, fin, type: r.type, trou: r.trou });
  }
  return out;
}

const enDate = (x: number): Date | null => (Number.isFinite(x) ? new Date(x) : null);

/**
 * Les périodes SANS congés, fusionnées. `typeFiche` sert quand le salarié n'a aucun contrat enregistré (règle 4) :
 * s'il est sans congés, la période est infinie. PURE.
 */
export function periodesSansConges(contrats: ContratPeriode[], typeFiche: string | null | undefined): PeriodeSansConges[] {
  const segs = segments(contrats);
  if (segs.length === 0) return typeSansConges(typeFiche) ? [{ debut: null, fin: null, type: String(typeFiche) }] : [];
  const plages: { debut: number; fin: number; type: string }[] = [];
  for (const s of segs) {
    if (!typeSansConges(s.type)) continue;
    const derniere = plages[plages.length - 1];
    if (derniere && derniere.fin + JOUR === s.debut) derniere.fin = s.fin; // deux tronçons sans congés qui se touchent : une seule période
    else plages.push({ debut: s.debut, fin: s.fin, type: s.type });
  }
  return plages.map((p) => ({ debut: enDate(p.debut), fin: enDate(p.fin), type: p.type }));
}

/** Les trous : plages de jours couvertes par aucun contrat entre deux contrats (règle 3). La tête de période n'en est pas un. PURE. */
export function trousDeContrat(contrats: ContratPeriode[]): { debut: Date; fin: Date | null }[] {
  return segments(contrats).filter((s) => s.trou).map((s) => ({ debut: new Date(s.debut), fin: enDate(s.fin) }));
}

/**
 * Le type de contrat qui régit un jour donné selon l'HISTORIQUE (règles 1 et 3 : contrat qui le couvre, sinon le
 * précédent, sinon le premier) ; null sans aucun contrat. Sert à signaler une fiche dont le type (`Employee.contrat`)
 * contredit l'historique — p. ex. fiche passée en CDI sans contrat CDI enregistré : l'historique dit « stage », le
 * solde suit l'historique, la Direction doit compléter les contrats. PURE.
 */
export function typeSelonHistorique(contrats: ContratPeriode[], jour: Date): string | null {
  const x = t(jour);
  const seg = segments(contrats).find((s) => s.debut <= x && x <= s.fin);
  return seg ? seg.type : null;
}

/**
 * Vrai si le mois [debut, fin] (jours inclus) ouvre droit à ses jours : aucun de ses jours ne tombe dans une
 * période sans congés. PURE.
 */
export function moisOuvreDroit(debut: Date, fin: Date, sansConges: PeriodeSansConges[]): boolean {
  const d = t(debut), f = t(fin);
  return !sansConges.some((p) => (p.debut === null || t(p.debut) <= f) && (p.fin === null || t(p.fin) >= d));
}
