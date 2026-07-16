import "server-only";
import { prisma } from "@/lib/prisma";
import { notifierSalarie, compteSalarieDe } from "@/lib/notifications";

const fr = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" });

/**
 * Finalise un échange de créneau UNIQUEMENT quand le collègue A ACCEPTÉ et la Direction A APPROUVÉ.
 * Permute alors les deux créneaux du planning (même jour = échange direct ; jours différents =
 * chacun prend le créneau de l'autre) et notifie les deux salariés. Idempotent.
 */
export async function finaliserEchangeSiComplet(id: string): Promise<boolean> {
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.statut !== "EN_ATTENTE") return false;
  if (e.reponseCollegue !== "ACCEPTE" || e.reponseDirection !== "APPROUVE") return false;

  const memeJour = new Date(e.demandeurDate).getTime() === new Date(e.collegueDate).getTime();
  const ops = memeJour
    ? [
        // Même jour : A ↔ B échangent leurs shifts.
        prisma.planningCreneau.upsert({
          where: { employeeId_date: { employeeId: e.demandeurId, date: e.demandeurDate } },
          update: { shiftId: e.collegueShiftId, genereAuto: false },
          create: { employeeId: e.demandeurId, date: e.demandeurDate, shiftId: e.collegueShiftId, genereAuto: false },
        }),
        prisma.planningCreneau.upsert({
          where: { employeeId_date: { employeeId: e.collegueId, date: e.collegueDate } },
          update: { shiftId: e.demandeurShiftId, genereAuto: false },
          create: { employeeId: e.collegueId, date: e.collegueDate, shiftId: e.demandeurShiftId, genereAuto: false },
        }),
      ]
    : [
        // Jours différents : B couvre le jour de A (shift de A), A couvre le jour de B (shift de B).
        prisma.planningCreneau.upsert({
          where: { employeeId_date: { employeeId: e.collegueId, date: e.demandeurDate } },
          update: { shiftId: e.demandeurShiftId, genereAuto: false },
          create: { employeeId: e.collegueId, date: e.demandeurDate, shiftId: e.demandeurShiftId, genereAuto: false },
        }),
        prisma.planningCreneau.upsert({
          where: { employeeId_date: { employeeId: e.demandeurId, date: e.collegueDate } },
          update: { shiftId: e.collegueShiftId, genereAuto: false },
          create: { employeeId: e.demandeurId, date: e.collegueDate, shiftId: e.collegueShiftId, genereAuto: false },
        }),
        prisma.planningCreneau.deleteMany({ where: { employeeId: e.demandeurId, date: e.demandeurDate } }),
        prisma.planningCreneau.deleteMany({ where: { employeeId: e.collegueId, date: e.collegueDate } }),
      ];

  await prisma.$transaction([
    ...ops,
    prisma.echangeCreneau.update({ where: { id }, data: { statut: "APPROUVE" } }),
  ]);

  // Notifier les deux salariés que l'échange est effectif.
  const [uA, uB] = await Promise.all([compteSalarieDe(e.demandeurId), compteSalarieDe(e.collegueId)]);
  const msg = `Échange de shift confirmé : ${fr(e.demandeurDate)} ↔ ${fr(e.collegueDate)}. Votre planning est à jour.`;
  if (uA) await notifierSalarie(uA, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:fait` });
  if (uB) await notifierSalarie(uB, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:fait` });
  return true;
}
