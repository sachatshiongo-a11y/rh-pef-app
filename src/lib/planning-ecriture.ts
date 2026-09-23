import "server-only";

// SEUL chemin d'écriture du planning (spec 2026-09-23 §6, décision Direction 3) : depuis que la paie
// de la brigade suit les heures PLANIFIÉES, un créneau est une pièce de paie. Chaque création,
// modification ou suppression est donc (1) refusée si la ligne de paie du salarié pour ce mois est
// VALIDÉE ou PAYÉE, (2) journalisée (qui, quand, avant, après) dans JournalAudit.
import { Prisma } from "@prisma/client";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { MOIS_FR } from "@/lib/dates-fr";

/** `shiftId: null` = effacer le créneau de ce jour. */
export type OperationCreneau = { employeeId: string; date: Date; shiftId: string | null };

export type Verrou = { employeeId: string; nom: string; mois: number; annee: number };

export class PlanningVerrouilleError extends Error {
  constructor(public readonly verrous: Verrou[]) {
    super(
      `Planning verrouillé : paie validée ou payée pour ${verrous.map((v) => `${v.nom} (${MOIS_FR[v.mois - 1]} ${v.annee})`).join(", ")}. ` +
        "Rouvrir la ligne de paie avant de modifier ce planning.",
    );
    this.name = "PlanningVerrouilleError";
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cle = (employeeId: string, d: Date) => `${employeeId}|${iso(d)}`;
const JOUR_MS = 86_400_000;
const STATUTS_VERROUILLANTS = new Set(["VALIDE", "PAYE"]);

/**
 * Erreurs de PROGRAMMATION de l'appelant, levées avant toute lecture ou écriture : une date qui
 * n'est pas à minuit UTC (le verrou lit le mois en UTC, une heure locale de Kinshasa le 1er à 00:00
 * tomberait le mois précédent) ; deux opérations sur le même (salarié, jour), dont l'une serait
 * sinon perdue sans que personne ne le sache.
 */
function controlerOperations(operations: OperationCreneau[]): void {
  const vus = new Set<string>();
  for (const o of operations) {
    const t = o.date.getTime();
    if (Number.isNaN(t) || t % JOUR_MS !== 0) {
      const lue = Number.isNaN(t) ? "date invalide" : o.date.toISOString();
      throw new Error(`ecrireCreneaux : date non normalisée pour ${o.employeeId} (${lue}) : attendu minuit UTC`);
    }
    const k = cle(o.employeeId, o.date);
    if (vus.has(k)) throw new Error(`ecrireCreneaux : opération en double pour ${k}`);
    vus.add(k);
  }
}

/**
 * (salarié, mois) touchés par `operations` dont la ligne de paie est VALIDÉE ou PAYÉE.
 *
 * Les lignes de paie de CHAQUE paire (salarié, mois) sont lues `FOR SHARE`, QUEL QUE SOIT leur
 * statut : une validation concurrente (UPDATE de la ligne) attend donc la fin de la transaction
 * qui écrit le planning, et une validation déjà en cours fait attendre cette lecture, qui voit
 * alors le statut validé. Le statut est filtré APRÈS la lecture : ne verrouiller que les lignes
 * déjà validées laisserait passer la validation d'une ligne encore ouverte. Hors transaction, le
 * verrou tombe à la fin de la requête ; seul un vrai `tx` protège de la course.
 */
export async function verrousPlanning(tx: Prisma.TransactionClient, operations: OperationCreneau[]): Promise<Verrou[]> {
  if (operations.length === 0) return [];
  const paires = [...new Set(operations.map((o) => `${o.employeeId}|${o.date.getUTCFullYear()}|${o.date.getUTCMonth() + 1}`))].map((p) => {
    const [employeeId, annee, mois] = p.split("|");
    return Prisma.sql`(${employeeId}, ${Number(annee)}::int, ${Number(mois)}::int)`;
  });
  // ORDER BY l."id" : les verrous sont toujours pris dans le même ordre (pas d'interblocage entre
  // deux écritures de planning qui se recouvrent).
  const lignes = await tx.$queryRaw<{ employeeId: string; nom: string; mois: number; annee: number; statutPaiement: string }[]>`
    SELECT l."employeeId", e."nom", r."mois", r."annee", l."statutPaiement"::text AS "statutPaiement"
    FROM "public"."PayrollLine" l
    JOIN "public"."PayrollRun" r ON r."id" = l."payrollRunId"
    JOIN "public"."Employee" e ON e."id" = l."employeeId"
    WHERE (l."employeeId", r."annee", r."mois") IN (VALUES ${Prisma.join(paires)})
    ORDER BY l."id"
    FOR SHARE OF l`;
  return lignes
    .filter((l) => STATUTS_VERROUILLANTS.has(l.statutPaiement))
    .map((l) => ({ employeeId: l.employeeId, nom: l.nom, mois: Number(l.mois), annee: Number(l.annee) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.annee - b.annee || a.mois - b.mois);
}

/**
 * Applique `operations` au planning dans la transaction `tx` : contrôle des opérations (dates à
 * minuit UTC, au plus une par (salarié, jour)), puis verrou (rien n'est écrit si un seul
 * (salarié, mois) est verrouillé, même hors transaction), puis écriture, puis une entrée de
 * journal par créneau RÉELLEMENT changé. Renvoie le nombre de créneaux changés.
 */
export async function ecrireCreneaux(
  tx: Prisma.TransactionClient,
  userId: string,
  operations: OperationCreneau[],
  opts: { genereAuto?: boolean } = {},
): Promise<number> {
  controlerOperations(operations);
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
  for (const o of operations) {
    const k = cle(o.employeeId, o.date);
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
