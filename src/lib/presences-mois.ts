import { lireMoisAnnee } from "@/lib/mois-route";
import { MOIS_FR } from "@/lib/dates-fr";

// PRÉSENCES D'UN MOIS PASSÉ (demande de la Direction du 12/10) — la partie PURE : quel mois afficher,
// jusqu'où naviguer, quelles adresses. La lecture en base et le refus d'écriture sont dans
// `presences-mois-serveur.ts`.
//
// Règles :
//  - sans `?mois=&annee=`, l'écran montre le mois RH COURANT, exactement comme avant ;
//  - on remonte jusqu'au premier mois qui a des présences, des heures ou une paie ; on n'avance
//    JAMAIS au-delà du mois RH courant (un mois à venir est refusé, pas remplacé en silence) ;
//  - un mois ANTÉRIEUR au mois RH courant est en LECTURE SEULE (aucun geste d'écriture à l'écran, et
//    le serveur refuse toute écriture de présence ou d'heures sur ses jours).

export type Periode = { mois: number; annee: number };

const rang = (p: Periode) => p.annee * 12 + (p.mois - 1);
const depuisRang = (r: number): Periode => ({ mois: (r % 12) + 1, annee: Math.floor(r / 12) });

/** Vrai si `p` est strictement antérieur à `courant`. */
export const estMoisPasse = (p: Periode, courant: Periode) => rang(p) < rang(courant);
export const memeMois = (a: Periode, b: Periode) => rang(a) === rang(b);

/** « septembre 2026 ». */
export const libelleMois = (p: Periode) => `${MOIS_FR[p.mois - 1]} ${p.annee}`;

/** Le mois (`AAAA-MM-JJ` → période) d'un jour saisi ; null si la date est illisible. */
export function periodeDuJour(iso: string): Periode | null {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const annee = Number(iso.slice(0, 4));
  const mois = Number(iso.slice(5, 7));
  return mois >= 1 && mois <= 12 ? { mois, annee } : null;
}

type ParamAdresse = string | string[] | undefined;
const premier = (v: ParamAdresse) => (Array.isArray(v) ? v[0] : v);

export type MoisResolu = { ok: true; periode: Periode; passe: boolean } | { ok: false; message: string };

/**
 * Le mois demandé à l'écran Présences (`?mois=&annee=`) : absent → mois RH courant ; illisible → refus ;
 * à venir → refus (on ne saisit ni ne consulte un mois que l'espace RH n'a pas encore ouvert).
 */
export function resoudreMoisPresences(sp: { mois?: ParamAdresse; annee?: ParamAdresse }, courant: Periode): MoisResolu {
  const q = new URLSearchParams();
  const m = premier(sp.mois);
  const a = premier(sp.annee);
  if (m !== undefined) q.set("mois", m);
  if (a !== undefined) q.set("annee", a);
  return resoudreRecherche(q, courant);
}

/** Même lecture, depuis la recherche d'une adresse (route d'export). */
export function resoudreRecherche(q: URLSearchParams, courant: Periode): MoisResolu {
  const lu = lireMoisAnnee(q, courant);
  if (!lu.ok) return { ok: false, message: `${lu.message} : attendu ?mois=1 à 12&annee=AAAA.` };
  const periode = { mois: lu.mois, annee: lu.annee };
  if (rang(periode) > rang(courant)) {
    return { ok: false, message: `Les présences se consultent jusqu'au mois en cours (${libelleMois(courant)}) : ${libelleMois(periode)} n'est pas encore ouvert.` };
  }
  return { ok: true, periode, passe: estMoisPasse(periode, courant) };
}

/**
 * Mois précédent / suivant accessibles depuis `affiche` (null = borne atteinte). On remonte jusqu'au
 * `premierAvecDonnees` (premier mois qui a des présences, des heures ou une paie ; null = aucune
 * donnée : le mois courant est la seule borne), jamais au-delà du mois `courant`.
 */
export function bornesNavigation(affiche: Periode, courant: Periode, premierAvecDonnees: Periode | null): { prec: Periode | null; suiv: Periode | null } {
  const plancher = Math.min(rang(premierAvecDonnees ?? courant), rang(courant));
  return {
    prec: rang(affiche) > plancher ? depuisRang(rang(affiche) - 1) : null,
    suiv: rang(affiche) < rang(courant) ? depuisRang(rang(affiche) + 1) : null,
  };
}

/**
 * Adresse de l'écran Présences sur le mois `cible`, en CONSERVANT la vue en cours (`vue`, `sem`, `emp`).
 * Le mois courant s'écrit SANS `mois`/`annee` : c'est l'adresse d'aujourd'hui, inchangée.
 */
export function hrefPresences(cible: Periode, courant: Periode, etat: { vue?: string | null; sem?: string | null; emp?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (!memeMois(cible, courant)) {
    q.set("mois", String(cible.mois));
    q.set("annee", String(cible.annee));
  }
  if (etat.vue && etat.vue !== "semaine") q.set("vue", etat.vue);
  if (etat.sem) q.set("sem", etat.sem);
  if (etat.emp) q.set("emp", etat.emp);
  const s = q.toString();
  return s ? `/presences?${s}` : "/presences";
}

/** Suffixe `&mois=…&annee=…` à ajouter aux adresses d'un mois autre que le mois courant (onglets, export). */
export function requeteMois(affiche: Periode, courant: Periode): string {
  return memeMois(affiche, courant) ? "" : `mois=${affiche.mois}&annee=${affiche.annee}`;
}

export const MESSAGE_MOIS_PASSE = (p: Periode, courant: Periode) =>
  `Mois passé — lecture seule : ${libelleMois(p)} est antérieur au mois en cours (${libelleMois(courant)}). Rien n'a été enregistré.`;
