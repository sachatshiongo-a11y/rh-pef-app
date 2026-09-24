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

/** Message affiché quand Postgres a dû annuler l'écriture pour sortir d'un interblocage. */
export const MESSAGE_INTERBLOCAGE = "La paie est en cours de validation : réessayez dans un instant.";

/** Message affiché quand une écriture concurrente a posé le même (salarié, jour) entre la lecture
 *  et l'écriture (violation de l'unicité `employeeId_date`) : rien n'a été écrit. */
export const MESSAGE_PLANNING_CHANGE = "Le planning a changé pendant l'enregistrement : réessayez.";

/**
 * Cherche un code d'erreur dans les seuls champs qui le portent, selon le chemin (requête brute,
 * requête du client, adaptateur `pg`) : `e.code`, `e.originalCode`, puis `meta`, `cause`,
 * `driverAdapterError` (profondeur bornée, protégé des cycles). Jamais le texte du message.
 */
function porteUnCode(e: unknown, codes: ReadonlySet<string>): boolean {
  const vus = new Set<unknown>();
  const fouiller = (x: unknown, profondeur: number): boolean => {
    if (x === null || typeof x !== "object" || profondeur > 6 || vus.has(x)) return false;
    vus.add(x);
    const o = x as Record<string, unknown>;
    if (codes.has(o.code as string) || codes.has(o.originalCode as string)) return true;
    return ["meta", "cause", "driverAdapterError"].some((k) => fouiller(o[k], profondeur + 1));
  };
  return fouiller(e, 0);
}

/**
 * Vrai si `e` est un interblocage Postgres (40P01) ou le conflit de transaction que Prisma en tire
 * (P2034). Selon le chemin (requête brute, requête du client, adaptateur `pg`), le code est porté
 * par `e.code`, `e.meta.code` ou `e.meta.driverAdapterError.cause.originalCode` : on fouille ces
 * seuls champs, sans jamais lire le texte du message.
 */
export function estInterblocage(e: unknown): boolean {
  return porteUnCode(e, new Set(["40P01", "P2034"]));
}

/** Vrai si `e` est une violation d'unicité : P2002 (client Prisma) ou 23505 (Postgres). Dans une
 *  écriture du planning, la seule unicité en jeu est (salarié, jour) : une course sur la même paire. */
export function estConflitUnicite(e: unknown): boolean {
  return porteUnCode(e, new Set(["P2002", "23505"]));
}

/**
 * Message lisible pour les refus attendus d'une écriture du planning (planning verrouillé,
 * interblocage avec une validation de paie, course sur un même (salarié, jour)), `null` pour toute
 * autre erreur (à relancer). Les actions le RENVOIENT comme une valeur : Next masque le message
 * des erreurs levées en production.
 */
export function messageErreurPlanning(e: unknown): string | null {
  if (e instanceof PlanningVerrouilleError) return e.message;
  if (estInterblocage(e)) return MESSAGE_INTERBLOCAGE;
  if (estConflitUnicite(e)) return MESSAGE_PLANNING_CHANGE;
  return null;
}

/**
 * Compte rendu d'une génération pour les (salarié, mois) figés, ou `undefined` s'il n'y en a pas :
 * « Paie validée ou payée : Martine Mutombo (septembre 2026) — ses créneaux de ce mois n'ont pas
 * été touchés ». Chaque salarié est nommé avec CHACUN de ses mois figés : ses autres jours de la
 * période, eux, ont été planifiés.
 */
export function messageMoisFiges(verrous: Verrou[]): string | undefined {
  if (verrous.length === 0) return undefined;
  const tries = [...verrous].sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.annee - b.annee || a.mois - b.mois);
  const parSalarie = new Map<string, { nom: string; mois: string[] }>();
  for (const v of tries) {
    const s = parSalarie.get(v.employeeId) ?? { nom: v.nom, mois: [] };
    const libelle = `${MOIS_FR[v.mois - 1]} ${v.annee}`;
    if (!s.mois.includes(libelle)) s.mois.push(libelle);
    parSalarie.set(v.employeeId, s);
  }
  const salaries = [...parSalarie.values()];
  const plusieursMois = new Set(tries.map((v) => `${v.annee}-${v.mois}`)).size > 1;
  return `Paie validée ou payée : ${salaries.map((s) => `${s.nom} (${s.mois.join(", ")})`).join(", ")} — ` +
    `${salaries.length > 1 ? "leurs" : "ses"} créneaux de ${plusieursMois ? "ces mois" : "ce mois"} n'ont pas été touchés`;
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
 * journal par créneau RÉELLEMENT changé. Renvoie le nombre de créneaux changés (le seul retrait du
 * marqueur ✨ ne compte pas : le shift, donc la paie, ne change pas).
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
    select: { employeeId: true, date: true, shiftId: true, genereAuto: true },
  });
  const avant = new Map(existants.map((e) => [cle(e.employeeId, e.date), e.shiftId]));
  const marques = new Set(existants.filter((e) => e.genereAuto).map((e) => cle(e.employeeId, e.date)));
  const genereAuto = opts.genereAuto ?? false;

  const aDemarquer: OperationCreneau[] = [];
  const aEffacer: OperationCreneau[] = [];
  const aCreer: OperationCreneau[] = [];
  const aModifier: OperationCreneau[] = [];
  const journal: EntreeJournal[] = [];
  for (const o of operations) {
    const k = cle(o.employeeId, o.date);
    const ancien = avant.get(k) ?? null;
    if (ancien === o.shiftId) {
      // Même shift ressaisi À LA MAIN sur un créneau ✨ généré : il devient une décision humaine, on
      // retire le marqueur. Ce n'est pas un changement de planning : pas d'entrée de journal.
      if (ancien !== null && !genereAuto && marques.has(k)) aDemarquer.push(o);
      continue;
    }
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
  if (aDemarquer.length > 0) {
    await tx.planningCreneau.updateMany({
      where: { OR: aDemarquer.map((o) => ({ employeeId: o.employeeId, date: o.date })) },
      data: { genereAuto: false },
    });
  }
  await journaliserPlusieurs(tx, journal);
  return journal.length;
}
