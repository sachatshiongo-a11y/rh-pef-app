// HORAIRE PAR DÉFAUT D'UNE PRÉSENCE — module PUR (ni base, ni `server-only`).
//
// Règle de Sacha (2026-10-12) : « l'heure par défaut lorsque l'on rentre la présence doit être
// l'horaire du planning du salarié ». Durée ET horaire (début, fin) viennent d'UNE seule source, choisie
// dans cet ordre strict, toujours pour CE jour-là :
//   1. le créneau de TRAVAIL planifié du jour (un Repos/Congé planifié, sans heures, passe au suivant) ;
//   2. le shift du MODÈLE hebdomadaire (couche de la parité A/B, sinon « chaque semaine ») ;
//   3. l'horaire du contrat (heures/jour, sans début ni fin).
// Le pré-remplissage des heures (presences-lot) et l'horaire affiché dans la grille (page Présences)
// appellent cette MÊME fonction : la durée et la plage horaire ne peuvent plus venir de deux sources.

import { dureeShift } from "@/lib/duree-shift";
import { pariteSemaine } from "@/lib/dates-fr";

export type ShiftHoraire = { heureDebut: string | null; heureFin: string | null; dureeHeures: { toString(): string } | number | null };
export type SourceHoraire = "PLANNING" | "MODELE" | "CONTRAT";
export type HoraireParDefaut = { debut: string | null; fin: string | null; heures: number; source: SourceHoraire };

export const dureeDe = (s: ShiftHoraire) =>
  dureeShift({ heureDebut: s.heureDebut, heureFin: s.heureFin, dureeHeures: s.dureeHeures != null ? Number(s.dureeHeures) : null });

/** Le shift du modèle hebdomadaire pour ce jour (couche de la parité, sinon « chaque semaine »). */
export function shiftIdDuModele(modele: Map<string, string>, employeeId: string, date: Date): string | undefined {
  const jour = date.getUTCDay();
  return modele.get(`${employeeId}|${jour}|${pariteSemaine(date)}`) ?? modele.get(`${employeeId}|${jour}|0`);
}

export function horaireParDefaut(p: { creneau: ShiftHoraire | null | undefined; modele: ShiftHoraire | null | undefined; heuresContrat: number }): HoraireParDefaut {
  if (p.creneau && dureeDe(p.creneau) > 0) return { debut: p.creneau.heureDebut, fin: p.creneau.heureFin, heures: dureeDe(p.creneau), source: "PLANNING" };
  if (p.modele && dureeDe(p.modele) > 0) return { debut: p.modele.heureDebut, fin: p.modele.heureFin, heures: dureeDe(p.modele), source: "MODELE" };
  return { debut: null, fin: null, heures: p.heuresContrat, source: "CONTRAT" };
}
