import "server-only";

import type { AttendanceCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dureeShift } from "@/lib/duree-shift";
import { pariteSemaine } from "@/lib/dates-fr";
import { POINTAGE_VALABLE } from "@/lib/pointage-annulation";

// CONTEXTE D'UNE SAISIE DE PRÉSENCES (unitaire ou en lot) — chargé UNE fois pour tout le lot
// (audit RH 2026-10-10 : un mois saisi d'un bloc faisait 5 à 7 requêtes PAR case, soit des milliers).
//
// Heures pré-remplies d'un jour P — ordre de priorité strict (règle tranchée) :
//   1. le CRÉNEAU PLANIFIÉ du jour (un Repos/Congé planifié, sans heures, passe au suivant) ;
//   2. le shift du MODÈLE HEBDO (couche de la parité A/B, sinon « chaque semaine ») ;
//   3. l'horaire contractuel (heures/jour).
//
// Jour SANS TRAVAIL (N, A, M, O, et C/S — pas d'heures pendant un congé) : les heures du jour sont
// retirées. On ne sait pas dire, en base, qui a écrit une heure ; on sait dire si elle VAUT ce que le
// logiciel aurait pré-rempli. Égale au pré-remplissage et sans pointage ce jour-là → « pré-remplie »,
// retirée et dite. Sinon (autre valeur, ou pointage QR du jour) → « saisie » : rien n'est écrit tant
// que l'utilisateur n'a pas confirmé.

export type Entree = { employeeId: string; date: string; code: AttendanceCode | "" };
export type HeuresDuJour = { employeeId: string; date: string; heures: number };

const CODES_SANS_HEURES: ReadonlySet<string> = new Set(["N", "A", "M", "O", "C", "S"]);
export const codeSansHeures = (code: string) => CODES_SANS_HEURES.has(code);

const LIBELLE_CODE: Record<string, string> = {
  N: "absence non justifiée", A: "absence justifiée", M: "maladie", O: "repos", C: "congé", S: "congé sans solde",
};
const fmtH = (h: number) => `${h.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
const jjmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

export async function chargerContextePresences(entrees: Entree[]) {
  const ids = [...new Set(entrees.map((e) => e.employeeId))];
  const dates = entrees.map((e) => e.date).sort();
  const vide = ids.length === 0;
  const plage = vide ? undefined : { gte: new Date(`${dates[0]}T00:00:00.000Z`), lte: new Date(`${dates[dates.length - 1]}T00:00:00.000Z`) };
  const [employes, creneaux, modeles, shifts, attendances, heures, pointages] = vide
    ? [[], [], [], [], [], [], []]
    : await Promise.all([
        prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, heuresParJour: true } }),
        prisma.planningCreneau.findMany({
          where: { employeeId: { in: ids }, date: plage },
          select: { employeeId: true, date: true, shift: { select: { heureDebut: true, heureFin: true, dureeHeures: true } } },
        }),
        prisma.planningModele.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, jour: true, semaine: true, shiftId: true } }),
        prisma.shift.findMany({ select: { id: true, heureDebut: true, heureFin: true, dureeHeures: true } }),
        prisma.attendance.findMany({ where: { employeeId: { in: ids }, date: plage }, select: { id: true, employeeId: true, date: true, code: true } }),
        prisma.overtimeEntry.findMany({ where: { employeeId: { in: ids }, date: plage }, select: { employeeId: true, date: true, heuresTravaillees: true } }),
        prisma.pointage.findMany({ where: { AND: [{ employeeId: { in: ids }, date: plage }, POINTAGE_VALABLE] }, select: { employeeId: true, date: true } }),
      ]);
  const duree = (s: { heureDebut: string | null; heureFin: string | null; dureeHeures: { toString(): string } | null }) =>
    dureeShift({ heureDebut: s.heureDebut, heureFin: s.heureFin, dureeHeures: s.dureeHeures != null ? Number(s.dureeHeures) : null });

  const contrat = new Map(employes.map((e) => [e.id, Number(e.heuresParJour)]));
  const creneauDuJour = new Map(creneaux.map((c) => [`${c.employeeId}|${iso(c.date)}`, duree(c.shift)]));
  const dureeParShift = new Map(shifts.map((s) => [s.id, duree(s)]));
  const modele = new Map(modeles.map((m) => [`${m.employeeId}|${m.jour}|${m.semaine}`, m.shiftId]));
  const ctx = {
    attendance: new Map(attendances.map((a) => [`${a.employeeId}|${iso(a.date)}`, { id: a.id, code: a.code }])),
    heures: new Map(heures.map((h) => [`${h.employeeId}|${iso(h.date)}`, Number(h.heuresTravaillees)])),
    pointes: new Set(pointages.map((p) => `${p.employeeId}|${iso(p.date)}`)),
    contrat,
    creneauDuJour,
    dureeParShift,
    modele,
    /** Sépare, parmi les entrées qui passent à un jour sans travail, les heures pré-remplies des saisies. */
    retraitHeures(es: Entree[]): { preRemplies: HeuresDuJour[]; saisies: HeuresDuJour[] } {
      const preRemplies: HeuresDuJour[] = [];
      const saisies: HeuresDuJour[] = [];
      for (const e of es) {
        if (!codeSansHeures(e.code)) continue;
        const k = `${e.employeeId}|${e.date}`;
        const h = ctx.heures.get(k);
        if (h === undefined) continue;
        const item = { employeeId: e.employeeId, date: e.date, heures: h };
        const commePreRempli = Math.abs(h - heuresPreRemplies(ctx, e.employeeId, e.date)) < 0.005;
        (commePreRempli && !ctx.pointes.has(k) ? preRemplies : saisies).push(item);
      }
      return { preRemplies, saisies };
    },
  };
  return ctx;
}

type Contexte = Awaited<ReturnType<typeof chargerContextePresences>>;

/** Heures que le logiciel pré-remplit pour un P ce jour-là (créneau > modèle > contrat). */
export function heuresPreRemplies(ctx: Pick<Contexte, "contrat" | "creneauDuJour" | "dureeParShift" | "modele">, employeeId: string, date: string): number {
  const planifie = ctx.creneauDuJour.get(`${employeeId}|${date}`) ?? 0;
  if (planifie > 0) return planifie;
  const d = new Date(`${date}T00:00:00.000Z`);
  const jour = d.getUTCDay();
  const sid = ctx.modele.get(`${employeeId}|${jour}|${pariteSemaine(d)}`) ?? ctx.modele.get(`${employeeId}|${jour}|0`);
  const duModele = sid ? ctx.dureeParShift.get(sid) ?? 0 : 0;
  if (duModele > 0) return duModele;
  return ctx.contrat.get(employeeId) ?? 8;
}

/** Question posée avant de retirer des heures SAISIES. */
export function messageRetraitAConfirmer(saisies: HeuresDuJour[], code?: AttendanceCode | ""): string {
  if (saisies.length === 1) {
    const s = saisies[0];
    return `Des heures ont été saisies le ${jjmm(s.date)} (${fmtH(s.heures)}). Un jour de ${LIBELLE_CODE[code ?? ""] ?? "non-travail"} n'a pas d'heures : elles seront retirées. Confirmer ?`;
  }
  const total = saisies.reduce((t, s) => t + s.heures, 0);
  return `${saisies.length} case(s) portent des heures saisies (${fmtH(total)} au total, ex. ${jjmm(saisies[0].date)}). Le code choisi n'a pas d'heures : elles seront retirées. Confirmer ? Rien n'a encore été enregistré.`;
}

/** Compte rendu des heures retirées (vide si aucune). */
export function messageRetraitFait(r: { preRemplies: HeuresDuJour[]; saisies: HeuresDuJour[] }): string {
  const parts: string[] = [];
  if (r.preRemplies.length > 0) {
    parts.push(`${fmtH(r.preRemplies.reduce((t, s) => t + s.heures, 0))} pré-remplie(s) retirée(s) sur ${r.preRemplies.length} jour(s) sans travail`);
  }
  if (r.saisies.length > 0) {
    parts.push(`${fmtH(r.saisies.reduce((t, s) => t + s.heures, 0))} saisie(s) retirée(s) sur ${r.saisies.length} jour(s), après confirmation`);
  }
  return parts.join(" ; ");
}
