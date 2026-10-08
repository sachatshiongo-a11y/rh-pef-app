import "server-only";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { MOIS_FR } from "@/lib/dates-fr";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { ATTENTE_VERROU_VALIDATION, ValidationPaieRefuseeError } from "@/lib/paie-validation";

// CHANGEMENT DU MOIS COURANT DE L'ESPACE RH (`Config.moisCourant` / `Config.anneeCourante`).
//
// Deux gestes, UN SEUL cœur (`changerMoisCourant`) :
//  - MANUEL : Paramètres > mois en cours (Direction seule) — corriger une erreur, revenir en arrière ;
//  - AUTOMATIQUE : une clôture de paie RÉUSSIE du mois courant fait passer l'espace RH au mois
//    suivant (demande de Sacha du 2026-10-08), DANS LA TRANSACTION de la clôture — tout ou rien.
// Le cœur fait tout ce que fait le changement de mois : refus de quitter un mois clôturé qui garde
// un bulletin rouvert en attente, écriture de `Config`, entrée au journal (auteur + origine). Les
// écrans sont rafraîchis par `revaliderApresChangementDeMois`, après le commit.
//
// Garde-fou : `changement-mois.garde-fou.test.ts` — aucun autre fichier n'écrit le mois courant.

export type Periode = { mois: number; annee: number };
export type OrigineChangementMois = "MANUEL" | "CLOTURE";

/** Le mois qui suit (décembre → janvier de l'année suivante). */
export function moisSuivant(p: Periode): Periode {
  return p.mois === 12 ? { mois: 1, annee: p.annee + 1 } : { mois: p.mois + 1, annee: p.annee };
}

export const memePeriode = (a: Periode, b: Periode) => a.mois === b.mois && a.annee === b.annee;

/** « septembre 2026 ». */
export const libellePeriode = (p: Periode) => `${MOIS_FR[p.mois - 1]} ${p.annee}`;

/** Ce que la confirmation de clôture annonce (écran /paie). */
export function annonceCloture(p: Periode): string {
  return `La paie de ${libellePeriode(p)} sera clôturée et l'espace RH passera à ${libellePeriode(moisSuivant(p))}.`;
}

/** Message après une clôture réussie. */
export function messageClotureReussie(close: Periode, vers: Periode): string {
  return `Paie de ${libellePeriode(close)} clôturée — l'espace RH est passé à ${libellePeriode(vers)}.`;
}

const ORIGINE: Record<OrigineChangementMois, string> = {
  MANUEL: "manuel (Paramètres)",
  CLOTURE: "automatique (clôture de la paie)",
};

/** Valeur « après » de l'entrée de journal : le mois et l'origine du passage. */
export const valeurJournal = (vers: Periode, origine: OrigineChangementMois) => `${libellePeriode(vers)} — ${ORIGINE[origine]}`;

/** Refus de quitter un mois CLÔTURÉ qui garde des bulletins rouverts en attente (message du geste manuel). */
export function messageRefusChangementMois(noms: string[]): string {
  return `La paie du mois en cours est clôturée mais ${noms.length} bulletin(s) rouvert(s) attendent d'être revalidés (${noms.join(", ")}) : revalidez-les dans Paie avant de changer de mois.`;
}

/** Le même refus, dit depuis la clôture : rien n'a été clôturé. */
export function messageRefusPassageApresCloture(noms: string[], vers: Periode): string {
  return `${noms.length} bulletin(s) compté(s) resteraient « pas validé » (${noms.join(", ")}) : l'espace RH ne peut pas passer à ${libellePeriode(vers)}.`;
}

/** Refus levé par le cœur : un refus de validation (message lisible, transaction annulée). */
export class ChangementMoisRefuseError extends ValidationPaieRefuseeError {
  constructor(message: string, readonly noms: string[]) {
    super(message);
    this.name = "ChangementMoisRefuseError";
  }
}

/**
 * Verrouille la ligne `Config` (FOR UPDATE, attente bornée) et relit le mois courant. Deux passages
 * concurrents (double clic, deux onglets, Paramètres pendant une clôture) s'attendent : le second lit
 * le mois déjà changé.
 */
export async function verrouillerMoisCourant(tx: Prisma.TransactionClient): Promise<Periode> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${ATTENTE_VERROU_VALIDATION}'`);
  await tx.$queryRaw`SELECT "id" FROM "public"."Config" WHERE "id" = 'singleton' FOR UPDATE`;
  const c = await tx.config.findUniqueOrThrow({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } });
  return { mois: c.moisCourant, annee: c.anneeCourante };
}

/**
 * Bulletins qui interdisent de QUITTER le mois `de` : paie du mois clôturée (PayrollRun « Validé ») et
 * lignes PAS VALIDÉES qui comptent encore (rouvertes pour correction, salarié toujours calculé). Le
 * mois quitté, elles deviendraient « hors calcul » (mois passé clôturé, paie-hors-calcul.ts) :
 * sorties des totaux et des déclarations, plus validables depuis /paie. À lire AVANT d'écrire le
 * nouveau mois (la règle « hors calcul » lit `Config`).
 */
export async function bulletinsRouvertsEnAttente(tx: Prisma.TransactionClient, de: Periode): Promise<string[]> {
  const run = await tx.payrollRun.findUnique({
    where: { mois_annee: { mois: de.mois, annee: de.annee } },
    select: { statut: true, lignes: { where: { statutPaiement: "PAS_VALIDE" }, select: { id: true, employeeId: true, statutPaiement: true, employee: { select: { nom: true } } } } },
  });
  if (run?.statut !== "VALIDE") return [];
  return (await lignesComptees(tx, run.lignes)).map((l) => l.employee.nom);
}

/**
 * LE CŒUR : passe l'espace RH au mois `vers`. À appeler dans une transaction, Config déjà verrouillée
 * (`verrouillerMoisCourant`, dont la lecture est passée en `de`). Rien à faire si `vers` = `de`.
 * Refus (`ChangementMoisRefuseError`, rien d'écrit) si le mois quitté garde des bulletins rouverts en
 * attente. Sinon : `Config` écrite et passage journalisé (auteur, ancien mois, nouveau mois + origine).
 */
export async function changerMoisCourant(
  tx: Prisma.TransactionClient,
  p: { de: Periode; vers: Periode; userId: string; origine: OrigineChangementMois },
): Promise<{ de: Periode; vers: Periode } | null> {
  if (memePeriode(p.de, p.vers)) return null;
  const noms = await bulletinsRouvertsEnAttente(tx, p.de);
  if (noms.length > 0) {
    throw new ChangementMoisRefuseError(
      p.origine === "CLOTURE" ? messageRefusPassageApresCloture(noms, p.vers) : messageRefusChangementMois(noms),
      noms,
    );
  }
  await tx.config.update({ where: { id: "singleton" }, data: { moisCourant: p.vers.mois, anneeCourante: p.vers.annee } });
  await journaliser(tx, {
    entite: "Config",
    entiteId: "singleton",
    champ: "moisCourant",
    ancienneValeur: libellePeriode(p.de),
    nouvelleValeur: valeurJournal(p.vers, p.origine),
    userId: p.userId,
  });
  return { de: p.de, vers: p.vers };
}

/**
 * Après la clôture RÉUSSIE de la paie `close` : si c'est le mois courant de l'espace RH, il passe au
 * mois suivant (même cœur que le geste manuel). Jamais de recul ni de saut : un mois clôturé qui n'est
 * pas le mois courant (passé, ou `Config` déjà au-delà) ne change rien. Idempotent sous le verrou de
 * `Config` : une seconde clôture du même mois lit le mois déjà passé et ne fait rien.
 */
export async function passerAuMoisSuivantApresCloture(
  tx: Prisma.TransactionClient,
  p: { close: Periode; userId: string },
): Promise<{ de: Periode; vers: Periode } | null> {
  const courant = await verrouillerMoisCourant(tx);
  if (!memePeriode(courant, p.close)) return null;
  return changerMoisCourant(tx, { de: courant, vers: moisSuivant(courant), userId: p.userId, origine: "CLOTURE" });
}

/** Après le commit d'un changement de mois : tout l'espace RH (en-tête, accueil, paie, présences…) relit le mois. */
export function revaliderApresChangementDeMois(): void {
  revalidatePath("/", "layout");
  revalidatePath("/parametres");
  revalidatePath("/accueil");
  revalidatePath("/paie");
}
