import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

// RÈGLES DE GARDE D'UNE DEMANDE DE CONGÉ — un seul endroit pour la Direction, la RH, l'espace
// salarié et les approbations en lot (audit RH du 2026-10-10) :
//  - le TYPE demandé existe et est actif (un nom libre envoyé par le navigateur ne fait plus foi) ;
//  - une demande ne RECOUVRE jamais une autre demande EN ATTENTE ou APPROUVÉE du même salarié (le
//    même congé saisi deux fois se décomptait deux fois du solde) ;
//  - le REMPLAÇANT n'est ni le salarié lui-même, ni un salarié lui-même en congé approuvé sur ces dates ;
//  - les types « Congé annuel » et « Congé sans solde » sont PROTÉGÉS (ni renommés, ni supprimés) :
//    le premier porte le solde, le second fait du jour un « S » non payé.

type Db = PrismaClient | Prisma.TransactionClient;

/** Types protégés par leur nom : ni renommés, ni supprimés (désactivables seulement). */
export const TYPES_CONGE_PROTEGES = ["Congé annuel", "Congé sans solde"] as const;
export const estTypeCongeProtege = (nom: string) => (TYPES_CONGE_PROTEGES as readonly string[]).includes(nom);

const jjmmaaaa = (d: Date) => {
  const iso = new Date(d).toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const STATUT_LISIBLE: Record<string, string> = { EN_ATTENTE: "en attente", APPROUVE: "approuvée" };

/**
 * Sérialise les écritures de congé d'UN salarié (verrou transactionnel Postgres, libéré au commit) :
 * deux envois simultanés (double clic, deux onglets) ne passent plus tous deux le contrôle de
 * recouvrement. À appeler en tête de la transaction qui contrôle puis écrit.
 */
export async function verrouillerCongesSalarie(tx: Prisma.TransactionClient, employeeId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`conges:${employeeId}`}))::text AS verrou`;
}

/** Le type demandé doit exister ET être actif. Renvoie le type ; sinon une erreur lisible. */
export async function exigerTypeCongeUtilisable(db: Db, nom: string): Promise<{ nom: string; tauxPct: number | null }> {
  const t = nom ? await db.typeConge.findUnique({ where: { nom }, select: { nom: true, tauxPct: true, actif: true } }) : null;
  if (!t) throw new Error(`Type de congé inconnu : « ${nom || "—"} ». Choisissez un type dans la liste. Rien n'a été enregistré.`);
  if (!t.actif) throw new Error(`Le type « ${nom} » est désactivé (Paramètres) : il ne se demande plus. Rien n'a été enregistré.`);
  return { nom: t.nom, tauxPct: t.tauxPct };
}

/** La première demande EN ATTENTE ou APPROUVÉE du salarié qui recouvre la période, sinon null. */
export async function demandeQuiRecouvre(
  db: Db,
  p: { employeeId: string; dateDebut: Date; dateFin: Date; exclureId?: string; statuts?: ("EN_ATTENTE" | "APPROUVE")[] },
) {
  return db.leaveRequest.findFirst({
    where: {
      employeeId: p.employeeId,
      statut: { in: p.statuts ?? ["EN_ATTENTE", "APPROUVE"] },
      dateDebut: { lte: p.dateFin },
      dateFin: { gte: p.dateDebut },
      ...(p.exclureId ? { id: { not: p.exclureId } } : {}),
    },
    orderBy: { dateDebut: "asc" },
    select: { id: true, type: true, dateDebut: true, dateFin: true, statut: true },
  });
}

/** Message lisible d'un recouvrement (`sujet` : « Ce salarié a » / « Vous avez »). */
export function messageRecouvrement(
  d: { type: string; dateDebut: Date; dateFin: Date; statut: string },
  sujet = "Ce salarié a",
): string {
  return `${sujet} déjà une demande ${STATUT_LISIBLE[d.statut] ?? d.statut.toLowerCase()} qui recouvre ces dates : ${d.type} du ${jjmmaaaa(d.dateDebut)} au ${jjmmaaaa(d.dateFin)}. Modifiez les dates ou traitez d'abord l'autre demande — rien n'a été enregistré.`;
}

/** Refuse (erreur lisible) une période qui recouvre une demande en attente ou approuvée. */
export async function exigerAucunRecouvrement(
  db: Db,
  p: { employeeId: string; dateDebut: Date; dateFin: Date; exclureId?: string },
  sujet?: string,
): Promise<void> {
  const autre = await demandeQuiRecouvre(db, p);
  if (autre) throw new Error(messageRecouvrement(autre, sujet));
}

/**
 * Le remplaçant : facultatif ; sinon une fiche active, autre que le salarié, et PAS lui-même en
 * congé approuvé sur ces dates (un remplaçant absent ne remplace personne en cuisine).
 */
export async function exigerRemplacantDisponible(
  db: Db,
  p: { remplacantId: string | null; employeeId: string; dateDebut: Date; dateFin: Date },
): Promise<void> {
  if (!p.remplacantId) return;
  if (p.remplacantId === p.employeeId) throw new Error("Le remplaçant ne peut pas être le salarié lui-même. Rien n'a été enregistré.");
  const r = await db.employee.findUnique({ where: { id: p.remplacantId }, select: { nom: true, actif: true } });
  if (!r || !r.actif) throw new Error("Remplaçant introuvable ou sorti des effectifs. Rien n'a été enregistré.");
  const conge = await demandeQuiRecouvre(db, { employeeId: p.remplacantId, dateDebut: p.dateDebut, dateFin: p.dateFin, statuts: ["APPROUVE"] });
  if (conge) {
    throw new Error(`${r.nom} ne peut pas remplacer : en congé approuvé (${conge.type}) du ${jjmmaaaa(conge.dateDebut)} au ${jjmmaaaa(conge.dateFin)}. Choisissez un autre remplaçant — rien n'a été enregistré.`);
  }
}
