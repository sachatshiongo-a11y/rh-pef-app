import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { POINTAGE_VALABLE } from "@/lib/pointage-annulation";
import { dureeDe, horaireParDefaut, shiftIdDuModele, type ShiftHoraire, type SourceHoraire } from "@/lib/horaire-par-defaut";

type Db = PrismaClient | Prisma.TransactionClient;
export type HoraireCase = { debut: string | null; fin: string | null; reel: boolean; pauseParDefaut?: boolean; source?: SourceHoraire | "POINTAGE" };

const heureKin = (x: Date) => new Date(x).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });

/**
 * Horaire AFFICHÉ de chaque case de Présences & heures (`${employé}_${jour}`), pour le mois :
 *  - pointage RÉEL (heures horodatées) s'il y en a un ;
 *  - sinon `horaireParDefaut` — la MÊME source que les heures pré-remplies d'un P (créneau de travail
 *    planifié > modèle hebdo) : la plage montrée et la durée écrite ne divergent plus ;
 *  - un Repos/Congé PLANIFIÉ (créneau sans heures) n'affiche rien, sauf si le jour est codé P (travail
 *    exceptionnel : la présence a pris le modèle, l'horaire montré aussi).
 * Rien n'est affiché pour l'horaire du seul contrat (pas de début ni de fin).
 */
export async function chargerHorairesDuMois(db: Db, annee: number, mois: number, employeeIds: string[]): Promise<Record<string, HoraireCase>> {
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(annee, mois, 0));
  const ids = { in: employeeIds };
  const [creneaux, modeles, shifts, pointages, codesP] = await Promise.all([
    db.planningCreneau.findMany({ where: { employeeId: ids, date: { gte: debut, lte: fin } }, select: { employeeId: true, date: true, shiftId: true } }),
    db.planningModele.findMany({ where: { employeeId: ids }, select: { employeeId: true, jour: true, semaine: true, shiftId: true } }),
    db.shift.findMany({ select: { id: true, heureDebut: true, heureFin: true, dureeHeures: true } }),
    db.pointage.findMany({ where: { AND: [{ employeeId: ids, date: { gte: debut, lte: fin } }, POINTAGE_VALABLE] }, select: { employeeId: true, date: true, heureDebut: true, heureFin: true, pauseParDefaut: true } }),
    db.attendance.findMany({ where: { employeeId: ids, date: { gte: debut, lte: fin }, code: "P" }, select: { employeeId: true, date: true } }),
  ]);
  const shiftParId = new Map(shifts.map((s) => [s.id, s as ShiftHoraire]));
  const modele = new Map(modeles.map((m) => [`${m.employeeId}|${m.jour}|${m.semaine}`, m.shiftId]));
  const creneauDuJour = new Map(creneaux.map((c) => [`${c.employeeId}_${new Date(c.date).getUTCDate()}`, shiftParId.get(c.shiftId)]));
  const estP = new Set(codesP.map((a) => `${a.employeeId}_${new Date(a.date).getUTCDate()}`));
  const res: Record<string, HoraireCase> = {};
  for (const employeeId of employeeIds) {
    for (let j = 1; j <= fin.getUTCDate(); j++) {
      const k = `${employeeId}_${j}`;
      const creneau = creneauDuJour.get(k);
      if (creneau && dureeDe(creneau) <= 0 && !estP.has(k)) continue; // repos/congé planifié
      const sid = shiftIdDuModele(modele, employeeId, new Date(Date.UTC(annee, mois - 1, j)));
      const h = horaireParDefaut({ creneau, modele: sid ? shiftParId.get(sid) : undefined, heuresContrat: 0 });
      if (h.source !== "CONTRAT" && h.debut) res[k] = { debut: h.debut, fin: h.fin, reel: false, source: h.source };
    }
  }
  for (const p of pointages) {
    res[`${p.employeeId}_${new Date(p.date).getUTCDate()}`] = {
      debut: heureKin(p.heureDebut),
      fin: p.heureFin ? heureKin(p.heureFin) : null,
      reel: true,
      // Pause posée d'office au départ scanné (30 min, NON déduite), jamais confondue avec une pause saisie.
      pauseParDefaut: !!p.heureFin && p.pauseParDefaut,
      source: "POINTAGE",
    };
  }
  return res;
}
