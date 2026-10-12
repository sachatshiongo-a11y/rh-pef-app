import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { numeroMoisCourantKinshasa, anneeCouranteKinshasa } from "@/lib/heure-kinshasa";
import { estMoisPasse, periodeDuJour, MESSAGE_MOIS_PASSE, type Periode } from "@/lib/presences-mois";

// PRÉSENCES D'UN MOIS PASSÉ — la partie qui lit la base (voir `presences-mois.ts` pour les règles).
//
// LE VERROU SERVEUR « MOIS PASSÉ » : un jour d'un mois ANTÉRIEUR au mois RH courant (`Config.moisCourant`,
// qui n'avance qu'à la clôture de la paie ou par la Direction dans Paramètres) ne reçoit plus ni code, ni
// heures, ni justificatif de maladie, ni import IVMS. Il s'ajoute aux verrous qui existaient déjà et
// qu'il ne remplace pas : « paie du mois VALIDÉE » (import IVMS, synchro des congés), « bulletin du
// salarié VALIDÉ ou PAYÉ » (maladie justifiée). Appelé par chaque action d'écriture de la grille.

type Db = PrismaClient | Prisma.TransactionClient;

/** Le mois RH courant — la même lecture que l'écran Présences (Config, sinon l'horloge de Kinshasa). */
export async function lirePeriodeCouranteRH(db: Db = prisma): Promise<Periode> {
  const c = await db.config.findUnique({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } });
  return { mois: c?.moisCourant ?? numeroMoisCourantKinshasa(), annee: c?.anneeCourante ?? anneeCouranteKinshasa() };
}

/**
 * Refus lisible si l'un des jours tombe dans un mois PASSÉ (tout ou rien : un lot qui en touche un seul
 * est refusé en entier, rien n'est écrit) ; null sinon. Une date illisible n'est pas jugée ici (les
 * contrôles propres à chaque action s'en chargent).
 */
export async function refusMoisPasse(dates: string[], db: Db = prisma): Promise<string | null> {
  if (dates.length === 0) return null;
  const courant = await lirePeriodeCouranteRH(db);
  let plusAncien: Periode | null = null;
  for (const d of dates) {
    const p = periodeDuJour(d);
    if (p && estMoisPasse(p, courant) && (!plusAncien || estMoisPasse(p, plusAncien))) plusAncien = p;
  }
  return plusAncien ? MESSAGE_MOIS_PASSE(plusAncien, courant) : null;
}

/** Le premier mois qui a des présences, des heures ou une paie calculée ; null si la base est vide. */
export async function premierMoisAvecDonnees(db: Db = prisma): Promise<Periode | null> {
  const [presence, heures, paie] = await Promise.all([
    db.attendance.aggregate({ _min: { date: true } }),
    db.overtimeEntry.aggregate({ _min: { date: true } }),
    db.payrollRun.findFirst({ orderBy: [{ annee: "asc" }, { mois: "asc" }], select: { mois: true, annee: true } }),
  ]);
  const candidats: Periode[] = [];
  for (const d of [presence._min.date, heures._min.date]) {
    if (d) candidats.push({ mois: new Date(d).getUTCMonth() + 1, annee: new Date(d).getUTCFullYear() });
  }
  if (paie) candidats.push(paie);
  if (candidats.length === 0) return null;
  return candidats.reduce((min, p) => (estMoisPasse(p, min) ? p : min));
}
