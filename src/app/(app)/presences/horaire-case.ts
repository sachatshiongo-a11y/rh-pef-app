// Lecture des horaires d'une case de Présences & heures — fonctions PURES (aucun calcul de paie :
// elles ne font que choisir la plage à AFFICHER et signaler les heures au-delà du shift prévu).

import { LIBELLE_PAUSE_PAR_DEFAUT } from "@/lib/pointage-qr";

/** Horaires du jour affichés dans la case (façon planning) : début et fin « HH:MM ».
 *  `reel` = heures issues d'un pointage horodaté (sinon : créneau planifié ou modèle hebdo).
 *  `pauseParDefaut` = vrai quand la journée pointée est close avec la pause posée d'office au départ
 *  scanné (le salarié n'a pas saisi la sienne) : affiché « p* » dans la case et en toutes lettres
 *  dans l'infobulle — « pause par défaut 30 min (non déduite) ». Elle ne retire aucune heure : les
 *  heures de la case valent départ − arrivée (décision d'argent de la Direction du 2026-09-29). */
export type InfoShift = { debut: string | null; fin: string | null; reel: boolean; pauseParDefaut?: boolean };

// « HH:MM » → minutes depuis minuit (null si non parsable).
function enMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
// minutes depuis minuit → « HH:MM » (modulo 24 h : un shift peut finir après minuit).
function enHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** Durée prévue d'un shift en heures (gère le passage minuit), ou null. */
function dureePrevueH(debut: string | null, fin: string | null): number | null {
  const d = enMinutes(debut);
  const f = enMinutes(fin);
  if (d === null || f === null) return null;
  const delta = f >= d ? f - d : f + 1440 - d;
  return delta / 60;
}

/**
 * Prépare l'affichage horaire d'une case : la plage à montrer, si la journée est en heures
 * supplémentaires (au-delà du shift prévu → ambre) et un libellé pour l'infobulle.
 *  — Réel (pointage) : on montre les heures horodatées telles quelles ; fin absente = « … ».
 *  — Planifié : en heures supp., la fin est RECALCULÉE (début + heures travaillées) pour montrer
 *    l'heure de fin effective ; sinon on montre la plage prévue.
 */
export function infoHoraire(
  c: { heures: number | null },
  info: InfoShift | undefined,
  heuresParJourContrat: number
): { horaire: string | null; supp: boolean; titre: string } {
  if (!info) return { horaire: null, supp: false, titre: "" };
  const worked = c.heures;
  const dureePrevue = dureePrevueH(info.debut, info.fin);
  const attendu = dureePrevue ?? heuresParJourContrat;
  const supp = worked !== null && worked > 0 && attendu > 0 && worked > attendu + 0.01;

  let horaire: string | null = null;
  if (info.reel) {
    horaire = info.debut ? `${info.debut}–${info.fin ?? "…"}` : null;
  } else if (supp && info.debut && worked !== null) {
    const dbt = enMinutes(info.debut);
    horaire = dbt !== null ? `${info.debut}–${enHHMM(dbt + worked * 60)}` : info.fin ? `${info.debut}–${info.fin}` : info.debut;
  } else if (info.debut && info.fin) {
    horaire = `${info.debut}–${info.fin}`;
  }

  const pause = info.reel && info.pauseParDefaut ? ` · ${LIBELLE_PAUSE_PAR_DEFAUT}` : "";
  const titre = horaire
    ? ` ${horaire}${info.reel ? " (pointage réel)" : " (planifié)"}${pause}${supp ? " · heures supp." : ""}`
    : "";
  return { horaire, supp, titre };
}
