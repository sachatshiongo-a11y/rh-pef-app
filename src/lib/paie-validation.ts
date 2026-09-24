import "server-only";

// Valider une ligne de paie REVÉRIFIE son montant (revue finale du 2026-09-24, point 1). Depuis que
// la paie de la brigade suit les heures PLANIFIÉES, le planning est une pièce de paie : une ligne
// calculée au chargement de /paie peut ne plus correspondre au planning quand on clique « Valider »
// (créneau ajouté entre-temps, heures saisies, écran « À valider » resté ouvert). Figer ce qui est en
// base validerait alors un montant faux sans que rien ne le signale.
//
// Dans la transaction qui valide, avant toute écriture :
//   1. verrou de la PayrollRun du mois (FOR SHARE, FOR UPDATE pour la clôture qui la modifie), puis
//      des lignes (FOR UPDATE) — même ordre que l'écriture du planning (run, puis lignes) et que le
//      recalcul (paie-refresh.ts) : une écriture du planning en cours fait attendre la validation, et
//      inversement ;
//   2. recalcul par le VRAI calcul (`calculerLignesPaie`), UNE fois par mois concerné, jamais une fois
//      par ligne, dans la transaction ;
//   3. comparaison au centime près avec la ligne enregistrée. Un seul écart refuse TOUTE la
//      transaction avec un message lisible. La ligne n'est jamais réécrite en silence : l'outil
//      signale, la Direction recharge et relit avant de valider.
import { Prisma } from "@prisma/client";
import { calculerLignesPaie, type DonneesLignePaie } from "@/lib/paie-batch";
import { estAttenteVerrouTropLongue, estInterblocage } from "@/lib/planning-ecriture";

/** Délai des transactions de validation (une ligne, un lot, la clôture) : recalcul du mois compris. */
export const DELAI_VALIDATION_PAIE = 120_000;

/** Attente maximale d'un verrou (ligne ou run tenus par une écriture du planning ou un recalcul) :
 *  au-delà, Postgres abandonne (55P03) et l'écran affiche `MESSAGE_VALIDATION_OCCUPEE`. Toujours
 *  bien en deçà du délai de la transaction, pour ne jamais finir sur une transaction expirée. */
export const ATTENTE_VERROU_VALIDATION = "20s";

export const MESSAGE_VALIDATION_OCCUPEE =
  "Le planning ou la paie est en cours de modification : réessayez la validation dans un instant.";

export const MESSAGE_LIGNE_RECALCULEE =
  "La paie a été recalculée depuis l'affichage de cette page : rechargez la page Paie avant de valider.";

export function messagePaieChangee(noms: string[]): string {
  return `La paie de ${noms.join(", ")} a changé depuis son calcul (planning ou heures modifiés) : rechargez la page Paie avant de valider.`;
}

/** Refus d'une validation : message destiné à l'écran, renvoyé comme une valeur par les actions. */
export class ValidationPaieRefuseeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationPaieRefuseeError";
  }
}

/**
 * Message lisible pour un refus de validation attendu (montant changé, ligne recalculée, verrou tenu
 * trop longtemps, interblocage, transaction expirée), `null` pour toute autre erreur (à relancer).
 */
export function messageErreurValidation(e: unknown): string | null {
  if (e instanceof ValidationPaieRefuseeError) return e.message;
  if (estAttenteVerrouTropLongue(e) || estInterblocage(e)) return MESSAGE_VALIDATION_OCCUPEE;
  return null;
}

/** Montants et heures comparés : ceux qui font le bulletin (net, brut, base imposable) et la
 *  référence d'heures qui les porte. Tous en Decimal(·, 2) en base. */
const CHAMPS_COMPARES = [
  "salNetUSD",
  "salBrutUSD",
  "netImposableUSD",
  "heuresContractuelles",
  "heuresTravaillees",
  "heuresPayeesNonTravaillees",
] as const satisfies readonly (keyof DonneesLignePaie)[];

/** Valeur calculée telle que la base l'aurait enregistrée (arrondi à 2 décimales, à mi-chemin
 *  loin de zéro, comme `numeric(·, 2)` de Postgres à partir de la même écriture décimale). */
const enBase = (v: number) => new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

type LigneEnregistree = { [K in (typeof CHAMPS_COMPARES)[number]]: Prisma.Decimal } & { sourceReference: string };

/** Vrai si la ligne enregistrée diffère du recalcul d'au moins un centime (ou d'une source). */
export function ligneDiffere(enregistree: LigneEnregistree, recalculee: DonneesLignePaie): boolean {
  if (enregistree.sourceReference !== recalculee.sourceReference) return true;
  return CHAMPS_COMPARES.some((k) => !new Prisma.Decimal(enregistree[k]).equals(enBase(recalculee[k])));
}

/** Attente de verrou bornée pour le reste de la transaction (`ATTENTE_VERROU_VALIDATION`). */
async function borneAttenteVerrou(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${ATTENTE_VERROU_VALIDATION}'`);
}

/** Clôture : la run du mois en FOR UPDATE AVANT de lire ses lignes PAS_VALIDE, pour qu'aucun
 *  recalcul (/paie) ne les remplace entre la lecture et la validation. */
export async function verrouillerRunExclusif(tx: Prisma.TransactionClient, runId: string): Promise<void> {
  await borneAttenteVerrou(tx);
  await tx.$queryRaw`SELECT r."id" FROM "public"."PayrollRun" r WHERE r."id" = ${runId} FOR UPDATE`;
}

/**
 * Verrouille puis revérifie, dans `tx`, les lignes `payrollLineIds` qui vont passer de PAS_VALIDE à
 * VALIDE. Lève `ValidationPaieRefuseeError` si une ligne a disparu (recalculée depuis l'affichage)
 * ou si son montant ne correspond plus au recalcul. Renvoie les ids contrôlés : seul ce jeton permet
 * à `appliquerTransitionPaie` de valider une ligne PAS_VALIDE.
 *
 * `verrouRun: "EXCLUSIF"` pour la clôture, qui modifie ensuite la run : la prendre d'emblée en
 * FOR UPDATE évite l'interblocage d'une montée de verrou face à une écriture du planning.
 */
export async function controlerLignesAValider(
  tx: Prisma.TransactionClient,
  payrollLineIds: string[],
  opts: { verrouRun?: "PARTAGE" | "EXCLUSIF" } = {},
): Promise<Set<string>> {
  const ids = [...new Set(payrollLineIds)];
  if (ids.length === 0) return new Set();
  await borneAttenteVerrou(tx);

  // 1. Verrous : la run du mois d'abord, puis les lignes, chacun dans l'ordre des id.
  const modeRun = opts.verrouRun === "EXCLUSIF" ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
  await tx.$queryRaw`
    SELECT r."id" FROM "public"."PayrollRun" r
    WHERE r."id" IN (SELECT l."payrollRunId" FROM "public"."PayrollLine" l WHERE l."id" IN (${Prisma.join(ids)}))
    ORDER BY r."id"
    ${modeRun}`;
  await tx.$queryRaw`
    SELECT l."id" FROM "public"."PayrollLine" l
    WHERE l."id" IN (${Prisma.join(ids)})
    ORDER BY l."id"
    FOR UPDATE`;

  const lignes = await tx.payrollLine.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      employeeId: true,
      statutPaiement: true,
      sourceReference: true,
      salNetUSD: true,
      salBrutUSD: true,
      netImposableUSD: true,
      heuresContractuelles: true,
      heuresTravaillees: true,
      heuresPayeesNonTravaillees: true,
      employee: { select: { nom: true } },
      payrollRun: { select: { mois: true, annee: true } },
    },
  });
  // Une ligne demandée qui n'existe plus a été supprimée puis recréée par un recalcul (/paie) :
  // l'écran qui la montrait est périmé. L'ignorer validerait moins de lignes que prévu, en silence.
  if (lignes.length < ids.length) throw new ValidationPaieRefuseeError(MESSAGE_LIGNE_RECALCULEE);

  const aValider = lignes.filter((l) => l.statutPaiement === "PAS_VALIDE");

  // 2. Recalcul : une fois par mois concerné.
  const parMois = new Map<string, typeof aValider>();
  for (const l of aValider) {
    const k = `${l.payrollRun.annee}-${l.payrollRun.mois}`;
    (parMois.get(k) ?? parMois.set(k, []).get(k)!).push(l);
  }
  const changees: string[] = [];
  for (const groupe of parMois.values()) {
    const { mois, annee } = groupe[0].payrollRun;
    const { lignes: recalculees } = await calculerLignesPaie(mois, annee, tx);
    const parSalarie = new Map(recalculees.map((r) => [r.employee.id, r.data]));
    // 3. Comparaison. Un salarié absent du recalcul (fiche désactivée, passé en intérim) n'aurait
    // plus de ligne au prochain recalcul : son montant a changé, lui aussi.
    for (const l of groupe) {
      const r = parSalarie.get(l.employeeId);
      if (!r || ligneDiffere(l, r)) changees.push(l.employee.nom);
    }
  }
  if (changees.length > 0) {
    throw new ValidationPaieRefuseeError(messagePaieChangee([...new Set(changees)].sort((a, b) => a.localeCompare(b, "fr"))));
  }
  return new Set(aValider.map((l) => l.id));
}
