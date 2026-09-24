import "server-only";
import { prisma } from "@/lib/prisma";
import { notifierSalarie, compteSalarieDe } from "@/lib/notifications";
import { ecrireCreneaux, messageErreurPlanning, type OperationCreneau } from "@/lib/planning-ecriture";

const fr = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" });

/**
 * Finalise un échange de créneau UNIQUEMENT quand le collègue A ACCEPTÉ et la Direction A APPROUVÉ.
 * Permute alors les deux créneaux du planning (même jour = échange direct ; jours différents =
 * chacun prend le créneau de l'autre) et notifie les deux salariés. Idempotent. Passe par
 * `ecrireCreneaux` (verrou de paie + journal) : `userId` = compte qui déclenche la finalisation
 * (Direction qui approuve, ou collègue qui accepte en dernier). Planning verrouillé (ou
 * interblocage avec une validation de paie) → `{ fait: false, erreur }` : rien n'est écrit et
 * l'échange reste EN_ATTENTE.
 */
export async function finaliserEchangeSiComplet(
  id: string,
  userId: string,
  opts: { approbationDirection?: boolean } = {},
): Promise<{ fait: boolean; erreur?: string }> {
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.statut !== "EN_ATTENTE") return { fait: false };
  // `approbationDirection` : la Direction approuve MAINTENANT. Sa réponse n'est écrite que DANS la
  // transaction de la permutation — refusée (paie verrouillée), l'échange reste « en attente de la
  // Direction » et l'espace salarié n'affiche jamais « Direction : approuvé » à tort.
  const directionOk = opts.approbationDirection || e.reponseDirection === "APPROUVE";
  if (e.reponseCollegue !== "ACCEPTE" || !directionOk) return { fait: false };

  // Dates relues de colonnes @db.Date : déjà à minuit UTC, comme l'exige `ecrireCreneaux`.
  const memeJour = new Date(e.demandeurDate).getTime() === new Date(e.collegueDate).getTime();
  const operations: OperationCreneau[] = memeJour
    ? [
        // Même jour : A ↔ B échangent leurs shifts.
        { employeeId: e.demandeurId, date: e.demandeurDate, shiftId: e.collegueShiftId },
        { employeeId: e.collegueId, date: e.collegueDate, shiftId: e.demandeurShiftId },
      ]
    : [
        // Jours différents : B couvre le jour de A (shift de A), A couvre le jour de B (shift de B).
        { employeeId: e.collegueId, date: e.demandeurDate, shiftId: e.demandeurShiftId },
        { employeeId: e.demandeurId, date: e.collegueDate, shiftId: e.collegueShiftId },
        { employeeId: e.demandeurId, date: e.demandeurDate, shiftId: null },
        { employeeId: e.collegueId, date: e.collegueDate, shiftId: null },
      ];

  try {
    // Transaction INTERACTIVE : le planning et le statut de l'échange passent ensemble, ou rien.
    await prisma.$transaction(async (tx) => {
      await ecrireCreneaux(tx, userId, operations);
      await tx.echangeCreneau.update({ where: { id }, data: { statut: "APPROUVE", reponseDirection: "APPROUVE" } });
    });
  } catch (err) {
    const erreur = messageErreurPlanning(err);
    if (erreur) return { fait: false, erreur };
    throw err;
  }

  // Notifier les deux salariés que l'échange est effectif.
  const [uA, uB] = await Promise.all([compteSalarieDe(e.demandeurId), compteSalarieDe(e.collegueId)]);
  const msg = `Échange de shift confirmé : ${fr(e.demandeurDate)} ↔ ${fr(e.collegueDate)}. Votre planning est à jour.`;
  if (uA) await notifierSalarie(uA, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:fait` });
  if (uB) await notifierSalarie(uB, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:fait` });
  return { fait: true };
}
