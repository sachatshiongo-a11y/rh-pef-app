import "server-only";

// SEUL chemin d'écriture du planning (spec 2026-09-23 §6, décision Direction 3) : depuis que la paie
// de la brigade suit les heures PLANIFIÉES, un créneau est une pièce de paie. Chaque création,
// modification ou suppression est donc (1) refusée si la ligne de paie du salarié pour ce mois est
// VALIDÉE ou PAYÉE, (2) journalisée (qui, quand, avant, après) dans JournalAudit.
import type { Prisma } from "@prisma/client";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { MOIS_FR } from "@/lib/dates-fr";

/** `shiftId: null` = effacer le créneau de ce jour. */
export type OperationCreneau = { employeeId: string; date: Date; shiftId: string | null };

export type Verrou = { employeeId: string; nom: string; mois: number; annee: number };

export class PlanningVerrouilleError extends Error {
  constructor(public readonly verrous: Verrou[]) {
    super(
      `Planning verrouillé : paie validée pour ${verrous.map((v) => `${v.nom} (${MOIS_FR[v.mois - 1]} ${v.annee})`).join(", ")}. ` +
        "Rouvrir la ligne de paie avant de modifier ce planning.",
    );
    this.name = "PlanningVerrouilleError";
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cle = (employeeId: string, d: Date) => `${employeeId}|${iso(d)}`;

/** (salarié, mois) touchés par `operations` dont la ligne de paie est VALIDÉE ou PAYÉE. */
export async function verrousPlanning(tx: Prisma.TransactionClient, operations: OperationCreneau[]): Promise<Verrou[]> {
  if (operations.length === 0) return [];
  const paires = new Set(operations.map((o) => `${o.employeeId}|${o.date.getUTCFullYear()}|${o.date.getUTCMonth() + 1}`));
  const mois = [...new Set(operations.map((o) => `${o.date.getUTCFullYear()}|${o.date.getUTCMonth() + 1}`))].map((m) => {
    const [annee, mo] = m.split("|").map(Number);
    return { annee, mois: mo };
  });
  const lignes = await tx.payrollLine.findMany({
    where: {
      employeeId: { in: [...new Set(operations.map((o) => o.employeeId))] },
      statutPaiement: { in: ["VALIDE", "PAYE"] },
      payrollRun: { OR: mois },
    },
    select: { employeeId: true, employee: { select: { nom: true } }, payrollRun: { select: { mois: true, annee: true } } },
  });
  return lignes
    .filter((l) => paires.has(`${l.employeeId}|${l.payrollRun.annee}|${l.payrollRun.mois}`))
    .map((l) => ({ employeeId: l.employeeId, nom: l.employee.nom, mois: l.payrollRun.mois, annee: l.payrollRun.annee }));
}

/**
 * Applique `operations` au planning dans la transaction `tx` : verrou d'abord (rien n'est écrit si
 * un seul (salarié, mois) est verrouillé), puis écriture, puis une entrée de journal par créneau
 * RÉELLEMENT changé. Renvoie le nombre de créneaux changés.
 */
export async function ecrireCreneaux(
  tx: Prisma.TransactionClient,
  userId: string,
  operations: OperationCreneau[],
  opts: { genereAuto?: boolean } = {},
): Promise<number> {
  const verrous = await verrousPlanning(tx, operations);
  if (verrous.length > 0) throw new PlanningVerrouilleError(verrous);

  const existants = operations.length === 0 ? [] : await tx.planningCreneau.findMany({
    where: { OR: operations.map((o) => ({ employeeId: o.employeeId, date: o.date })) },
    select: { employeeId: true, date: true, shiftId: true },
  });
  const avant = new Map(existants.map((e) => [cle(e.employeeId, e.date), e.shiftId]));
  const genereAuto = opts.genereAuto ?? false;

  const aEffacer: OperationCreneau[] = [];
  const aCreer: OperationCreneau[] = [];
  const aModifier: OperationCreneau[] = [];
  const journal: EntreeJournal[] = [];
  const vus = new Set<string>();
  for (const o of operations) {
    const k = cle(o.employeeId, o.date);
    if (vus.has(k)) continue; // une seule opération par (salarié, jour) : la première
    vus.add(k);
    const ancien = avant.get(k) ?? null;
    if (ancien === o.shiftId) continue;
    if (o.shiftId === null) aEffacer.push(o);
    else if (ancien === null) aCreer.push(o);
    else aModifier.push(o);
    journal.push({ entite: "PlanningCreneau", entiteId: k, champ: "shiftId", ancienneValeur: ancien, nouvelleValeur: o.shiftId, userId });
  }

  if (aEffacer.length > 0) {
    await tx.planningCreneau.deleteMany({ where: { OR: aEffacer.map((o) => ({ employeeId: o.employeeId, date: o.date })) } });
  }
  if (aCreer.length > 0) {
    await tx.planningCreneau.createMany({ data: aCreer.map((o) => ({ employeeId: o.employeeId, date: o.date, shiftId: o.shiftId!, genereAuto })) });
  }
  for (const o of aModifier) {
    await tx.planningCreneau.update({
      where: { employeeId_date: { employeeId: o.employeeId, date: o.date } },
      data: { shiftId: o.shiftId!, genereAuto },
    });
  }
  await journaliserPlusieurs(tx, journal);
  return journal.length;
}
