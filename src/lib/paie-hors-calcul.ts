import type { PaymentStatus, Prisma, PrismaClient } from "@prisma/client";

/**
 * LIGNES DE PAIE « HORS CALCUL » (décision de Sacha du 2026-10-01).
 *
 * Depuis que le recalcul ne supprime plus une ligne qui a un historique (paie-refresh.ts), la ligne
 * ROUVERTE d'un salarié sorti du calcul (fiche désactivée, passage en intérim) reste en base, PAS
 * VALIDÉE, avec son ancien montant : elle n'est plus recalculée et ne peut pas être validée.
 * Elle ne doit plus COMPTER — ni dans les totaux, ni dans le livre de paie, ni dans les déclarations,
 * ni dans les exports Excel/PDF — sans être supprimée : l'écran Paie la montre À PART, marquée
 * « hors calcul — ligne rouverte », avec ses deux sorties (réactiver la fiche le temps de valider, ou
 * réinitialiser la paie du mois).
 *
 * Une ligne VALIDÉE ou PAYÉE compte toujours (bulletin émis), quel que soit l'état de la fiche
 * aujourd'hui. Une ligne PAS VALIDÉE est mise à part :
 *   • si son salarié n'est plus calculé (fiche désactivée, intérim) ;
 *   • ou si elle appartient à un mois PASSÉ déjà CLÔTURÉ (PayrollRun VALIDE, mois ≠ mois courant) :
 *     la clôture l'a laissée de côté, et le mois clôturé ne doit plus bouger — réactiver la fiche
 *     ou changer le contrat aujourd'hui ne la fait pas revenir dans les totaux de ce mois-là.
 *
 * RÈGLE UNIQUE « qui est calculé » : `estCalculeEnPaie`, appelée AUSSI par le moteur
 * (`calculerLignesPaie`, paie-batch.ts) — l'écart entre « calculé » et « compté » ne peut pas naître.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Le salarié est-il dans le calcul de la paie ? Actif, et son régime (type du contrat ACTIF le plus
 *  récent, sinon celui de la fiche) n'est pas l'intérim (salarié de l'agence, payé par elle). */
export function estCalculeEnPaie(e: { actif: boolean; contrat: string }, typeContratActif: string | undefined): boolean {
  if (!e.actif) return false;
  return (typeContratActif ?? e.contrat) !== "INTERIM";
}

/** Ordre des contrats ACTIF, partagé avec paie-batch.ts : le dernier lu l'emporte. Départagé par la
 *  création puis l'identifiant — deux contrats de même date de début ne tombent plus au hasard. */
export const ORDRE_CONTRATS_ACTIFS = [{ dateDebut: "asc" }, { createdAt: "asc" }, { id: "asc" }] satisfies Prisma.ContratOrderByWithRelationInput[];

/** Type du contrat ACTIF le plus récent par salarié — même lecture que paie-batch.ts. */
export async function typesContratActifs(db: Db, employeeIds?: string[]): Promise<Map<string, string>> {
  const contrats = await db.contrat.findMany({
    where: { statut: "ACTIF", ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    orderBy: ORDRE_CONTRATS_ACTIFS,
    select: { employeeId: true, type: true },
  });
  const types = new Map<string, string>();
  for (const c of contrats) types.set(c.employeeId, c.type);
  return types;
}

type LigneMinimale = { id: string; employeeId: string; statutPaiement: PaymentStatus };

/** Identifiants des lignes HORS CALCUL parmi `lignes` (voir l'en-tête du module). */
export async function idsLignesHorsCalcul(db: Db, lignes: LigneMinimale[]): Promise<Set<string>> {
  const candidates = lignes.filter((l) => l.statutPaiement === "PAS_VALIDE");
  if (candidates.length === 0) return new Set();
  const ids = [...new Set(candidates.map((l) => l.employeeId))];
  const [employes, types, runs, config] = await Promise.all([
    db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, actif: true, contrat: true } }),
    typesContratActifs(db, ids),
    db.payrollLine.findMany({ where: { id: { in: candidates.map((l) => l.id) } }, select: { id: true, payrollRun: { select: { statut: true, mois: true, annee: true } } } }),
    db.config.findUnique({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } }),
  ]);
  const calcule = new Map(employes.map((e) => [e.id, estCalculeEnPaie(e, types.get(e.id))]));
  const moisPasseClos = new Set(
    runs
      .filter(({ payrollRun: r }) => r.statut === "VALIDE" && !(config && r.mois === config.moisCourant && r.annee === config.anneeCourante))
      .map((l) => l.id),
  );
  return new Set(candidates.filter((l) => calcule.get(l.employeeId) === false || moisPasseClos.has(l.id)).map((l) => l.id));
}

/** Sépare les lignes qui COMPTENT (totaux, livre, déclarations, exports) de celles hors calcul. */
export async function separerHorsCalcul<T extends LigneMinimale>(db: Db, lignes: T[]): Promise<{ comptees: T[]; horsCalcul: T[] }> {
  const hors = await idsLignesHorsCalcul(db, lignes);
  return { comptees: lignes.filter((l) => !hors.has(l.id)), horsCalcul: lignes.filter((l) => hors.has(l.id)) };
}

/** Les seules lignes qui comptent. Raccourci de `separerHorsCalcul`. */
export async function lignesComptees<T extends LigneMinimale>(db: Db, lignes: T[]): Promise<T[]> {
  return (await separerHorsCalcul(db, lignes)).comptees;
}

/** Nombre de lignes PAS VALIDÉES qui comptent (à valider), pour les compteurs et rappels. */
export async function compterPasValideComptees(db: Db, where: Prisma.PayrollLineWhereInput): Promise<number> {
  const lignes = await db.payrollLine.findMany({ where: { ...where, statutPaiement: "PAS_VALIDE" }, select: { id: true, employeeId: true, statutPaiement: true } });
  return (await lignesComptees(db, lignes)).length;
}
