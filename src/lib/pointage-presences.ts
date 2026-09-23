import "server-only";

// Ce que le pointage (bouton historique ET scan de l'affiche QR) partage avec les présences :
// le compte lié à une fiche employé, les deux refus communs (paie du mois validée, congé approuvé
// ce jour) et l'écriture d'un jour pointé dans Présences + Heures. Un seul endroit : les deux
// chemins de pointage appliquent exactement les mêmes règles.
//
// `client` accepte un client de transaction : `confirmerDepartScan` clôt le pointage et écrit les
// présences dans la MÊME transaction (une paie validée entre-temps n'y laisse rien à moitié fait).

import type { Prisma } from "@prisma/client";

type Client = Prisma.TransactionClient;

/** L'employé lié au compte (le pointage est TOUJOURS pour soi-même). Lève une erreur lisible sinon. */
export async function employeLieAuCompte(client: Client, userId: string): Promise<string> {
  const u = await client.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  if (!u?.employeeId)
    throw new Error("Votre compte n'est pas encore lié à une fiche employé. Demandez à la Direction de faire le lien.");
  return u.employeeId;
}

/** Refuse un pointage si la paie du mois de `date` est validée (figée) ou si un congé approuvé couvre ce jour. */
export async function refusSiPaieValideeOuConge(client: Client, employeeId: string, date: Date): Promise<void> {
  const mois = date.getUTCMonth() + 1;
  const annee = date.getUTCFullYear();
  const run = await client.payrollRun.findUnique({ where: { mois_annee: { mois, annee } }, select: { statut: true } });
  if (run?.statut === "VALIDE") throw new Error("La paie du mois est validée : pointage impossible.");
  const conge = await client.leaveRequest.findFirst({
    where: { employeeId, statut: "APPROUVE", dateDebut: { lte: date }, dateFin: { gte: date } },
    select: { id: true },
  });
  if (conge) throw new Error("Vous êtes en congé approuvé aujourd'hui — pas de pointage.");
}

/** Écrit un jour pointé dans Présences (code P/F) + Heures — mêmes garde-fous que l'import IVMS. */
export async function appliquerAuxPresences(client: Client, employeeId: string, date: Date, heures: number): Promise<void> {
  const mois = date.getUTCMonth() + 1;
  const annee = date.getUTCFullYear();
  const run = await client.payrollRun.findUnique({ where: { mois_annee: { mois, annee } }, select: { statut: true } });
  if (run?.statut === "VALIDE")
    throw new Error(`La paie de ${String(mois).padStart(2, "0")}/${annee} est validée (figée) : pointage impossible.`);
  // Congé approuvé ce jour : le congé prime, on n'écrit ni présence ni heures.
  const conge = await client.leaveRequest.findFirst({
    where: { employeeId, statut: "APPROUVE", dateDebut: { lte: date }, dateFin: { gte: date } },
    select: { id: true },
  });
  if (conge) return;

  await client.overtimeEntry.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: { heuresTravaillees: heures },
    create: { employeeId, date, heuresTravaillees: heures },
  });
  const ferie = await client.jourFerie.findFirst({ where: { date }, select: { id: true } });
  const presence = await client.attendance.findUnique({ where: { employeeId_date: { employeeId, date } } });
  if (!presence) await client.attendance.create({ data: { employeeId, date, code: ferie ? "F" : "P" } });
}
