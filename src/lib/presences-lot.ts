import "server-only";

import type { AttendanceCode, Prisma } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { horaireParDefaut, shiftIdDuModele, type ShiftHoraire } from "@/lib/horaire-par-defaut";
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

  const contrat = new Map(employes.map((e) => [e.id, Number(e.heuresParJour)]));
  const creneauDuJour = new Map(creneaux.map((c) => [`${c.employeeId}|${iso(c.date)}`, c.shift as ShiftHoraire]));
  const shiftParId = new Map(shifts.map((s) => [s.id, s as ShiftHoraire]));
  const modele = new Map(modeles.map((m) => [`${m.employeeId}|${m.jour}|${m.semaine}`, m.shiftId]));
  const ctx = {
    attendance: new Map(attendances.map((a) => [`${a.employeeId}|${iso(a.date)}`, { id: a.id, code: a.code }])),
    heures: new Map(heures.map((h) => [`${h.employeeId}|${iso(h.date)}`, Number(h.heuresTravaillees)])),
    pointes: new Set(pointages.map((p) => `${p.employeeId}|${iso(p.date)}`)),
    contrat,
    creneauDuJour,
    shiftParId,
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

/** Heures que le logiciel pré-remplit pour un P ce jour-là : `horaireParDefaut` (créneau de travail
 *  planifié > modèle hebdo > contrat) — la MÊME source que l'horaire affiché dans la grille. */
export function heuresPreRemplies(ctx: Pick<Contexte, "contrat" | "creneauDuJour" | "shiftParId" | "modele">, employeeId: string, date: string): number {
  const d = new Date(`${date}T00:00:00.000Z`);
  const sid = shiftIdDuModele(ctx.modele, employeeId, d);
  return horaireParDefaut({
    creneau: ctx.creneauDuJour.get(`${employeeId}|${date}`),
    modele: sid ? ctx.shiftParId.get(sid) : undefined,
    heuresContrat: ctx.contrat.get(employeeId) ?? 8,
  }).heures;
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

/**
 * PLANNING CHANGÉ APRÈS UNE PRÉSENCE (saisie d'avance, planning publié ensuite) : à l'écriture d'un
 * créneau, les heures d'un jour codé P qui valent encore le DÉFAUT d'avant (ancien créneau, sinon
 * modèle, sinon contrat) sont recalées sur le nouveau défaut — c'était un pré-remplissage, il suit le
 * planning. Des heures qui ne valent PAS l'ancien défaut ont été saisies (ou pointées) : jamais
 * écrasées, rendues dans `gardees` pour être signalées. Dans la transaction de l'écriture du planning.
 */
export async function resynchroniserHeuresPlanifiees(
  tx: Prisma.TransactionClient,
  entrees: { employeeId: string; date: Date; ancienShiftId: string | null }[],
  userId: string,
): Promise<{ recalees: number; gardees: { employeeId: string; date: string; heures: number; planifiees: number }[] }> {
  const gardees: { employeeId: string; date: string; heures: number; planifiees: number }[] = [];
  if (entrees.length === 0) return { recalees: 0, gardees };
  const ids = [...new Set(entrees.map((e) => e.employeeId))];
  const ou = entrees.map((e) => ({ employeeId: e.employeeId, date: e.date }));
  const [presences, heures, pointages, creneaux, modeles, shifts, employes] = await Promise.all([
    tx.attendance.findMany({ where: { OR: ou, code: "P" }, select: { employeeId: true, date: true } }),
    tx.overtimeEntry.findMany({ where: { OR: ou }, select: { employeeId: true, date: true, heuresTravaillees: true } }),
    tx.pointage.findMany({ where: { AND: [{ OR: ou }, POINTAGE_VALABLE] }, select: { employeeId: true, date: true } }),
    tx.planningCreneau.findMany({ where: { OR: ou }, select: { employeeId: true, date: true, shiftId: true } }),
    tx.planningModele.findMany({ where: { employeeId: { in: ids } }, select: { employeeId: true, jour: true, semaine: true, shiftId: true } }),
    tx.shift.findMany({ select: { id: true, heureDebut: true, heureFin: true, dureeHeures: true } }),
    tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, heuresParJour: true } }),
  ]);
  const k = (employeeId: string, d: Date) => `${employeeId}|${iso(d)}`;
  const estP = new Set(presences.map((p) => k(p.employeeId, p.date)));
  const heuresDuJour = new Map(heures.map((h) => [k(h.employeeId, h.date), Number(h.heuresTravaillees)]));
  const pointe = new Set(pointages.map((p) => k(p.employeeId, p.date)));
  const creneauActuel = new Map(creneaux.map((c) => [k(c.employeeId, c.date), c.shiftId]));
  const modele = new Map(modeles.map((m) => [`${m.employeeId}|${m.jour}|${m.semaine}`, m.shiftId]));
  const shiftParId = new Map(shifts.map((s) => [s.id, s as ShiftHoraire]));
  const contrat = new Map(employes.map((e) => [e.id, Number(e.heuresParJour)]));
  let recalees = 0;
  for (const e of entrees) {
    const cle = k(e.employeeId, e.date);
    const h = heuresDuJour.get(cle);
    if (!estP.has(cle) || h === undefined || pointe.has(cle)) continue;
    const sid = shiftIdDuModele(modele, e.employeeId, e.date);
    const base = { modele: sid ? shiftParId.get(sid) : undefined, heuresContrat: contrat.get(e.employeeId) ?? 8 };
    const ancien = horaireParDefaut({ ...base, creneau: e.ancienShiftId ? shiftParId.get(e.ancienShiftId) : undefined }).heures;
    const actuelId = creneauActuel.get(cle);
    const nouveau = horaireParDefaut({ ...base, creneau: actuelId ? shiftParId.get(actuelId) : undefined }).heures;
    if (Math.abs(h - nouveau) < 0.005) continue;
    if (Math.abs(h - ancien) < 0.005) {
      await tx.overtimeEntry.update({ where: { employeeId_date: { employeeId: e.employeeId, date: e.date } }, data: { heuresTravaillees: nouveau } });
      await journaliser(tx, { entite: "OvertimeEntry", entiteId: `${e.employeeId}_${iso(e.date)}`, champ: "heuresTravaillees", ancienneValeur: String(h), nouvelleValeur: `${nouveau} (pré-remplissage recalé sur le planning modifié)`, userId });
      recalees++;
    } else {
      gardees.push({ employeeId: e.employeeId, date: iso(e.date), heures: h, planifiees: nouveau });
      await journaliser(tx, { entite: "OvertimeEntry", entiteId: `${e.employeeId}_${iso(e.date)}`, champ: "heuresGardees", ancienneValeur: String(h), nouvelleValeur: `heures saisies gardées : le planning modifié prévoit ${nouveau} h`, userId });
    }
  }
  return { recalees, gardees };
}
