import "server-only";
import { prisma } from "@/lib/prisma";
import { calculerEcarts, type EntreesEcart, type ResultatEcart } from "@/lib/planning-ecart";
import { dureeShift } from "./creneaux";

export type EcartEmployeInfo = { nom: string; photoUrl: string | null };
export type EcartShiftInfo = { nom: string; heureDebut: string | null; heureFin: string | null; couleur: string };

export type EcartMois = {
  debut: Date;
  fin: Date;
  resultat: ResultatEcart;
  employesInfo: Map<string, EcartEmployeInfo>;
  shiftsInfo: Map<string, EcartShiftInfo>;
};

/**
 * Charge tout ce qu'il faut pour la vue « écart prévu/réalisé » du mois `mois`/`annee` et appelle
 * le module pur `calculerEcarts` (src/lib/planning-ecart.ts). Partagé par la page (affichage) et la
 * route d'export Excel, pour ne charger/calculer qu'à un seul endroit.
 *
 * Même filtre que les autres vues du planning : employés ACTIFS uniquement (cohérent avec les vues
 * Semaine/Mois, qui ont la même limite pour un employé sorti d'effectif en cours de période).
 */
export async function chargerEcartMois(mois: number, annee: number): Promise<EcartMois> {
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(annee, mois, 0));

  const [employeesRaw, shiftsRaw, creneaux, attendances, heuresRaw] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: { id: true, nom: true, poste: true, photoUrl: true },
    }),
    prisma.shift.findMany(),
    prisma.planningCreneau.findMany({
      where: { date: { gte: debut, lte: fin } },
      select: { employeeId: true, date: true, shiftId: true },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: debut, lte: fin } },
      select: { employeeId: true, date: true, code: true },
    }),
    prisma.overtimeEntry.findMany({
      where: { date: { gte: debut, lte: fin } },
      select: { employeeId: true, date: true, heuresTravaillees: true },
    }),
  ]);

  const shifts = shiftsRaw.map((s) => ({
    id: s.id,
    nom: s.nom,
    dureeHeures: dureeShift({
      heureDebut: s.heureDebut,
      heureFin: s.heureFin,
      dureeHeures: s.dureeHeures == null ? null : Number(s.dureeHeures),
    }),
  }));

  const entrees: EntreesEcart = {
    debut,
    fin,
    employes: employeesRaw.map((e) => ({ id: e.id, nom: e.nom, poste: e.poste })),
    shifts,
    creneaux: creneaux.map((c) => ({ employeeId: c.employeeId, date: c.date, shiftId: c.shiftId })),
    codes: attendances.map((a) => ({ employeeId: a.employeeId, date: a.date, code: a.code })),
    heures: heuresRaw.map((h) => ({
      employeeId: h.employeeId,
      date: h.date,
      heuresTravaillees: Number(h.heuresTravaillees),
    })),
  };

  const resultat = calculerEcarts(entrees);

  return {
    debut,
    fin,
    resultat,
    employesInfo: new Map(employeesRaw.map((e) => [e.id, { nom: e.nom, photoUrl: e.photoUrl }])),
    shiftsInfo: new Map(shiftsRaw.map((s) => [s.id, { nom: s.nom, heureDebut: s.heureDebut, heureFin: s.heureFin, couleur: s.couleur }])),
  };
}
