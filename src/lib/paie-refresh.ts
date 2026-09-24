import "server-only";
import { prisma } from "@/lib/prisma";
import { calculerLignesPaie } from "@/lib/paie-batch";
import { ATTENTE_VERROU_VALIDATION } from "@/lib/paie-validation";
import type { PaymentStatus } from "@prisma/client";

// États figés : une ligne validée ou payée n'est jamais recalculée / écrasée (bulletin émis).
export const STATUTS_FIGES: PaymentStatus[] = ["VALIDE", "PAYE"];

/**
 * (Re)calcule les lignes NON FIGÉES de la paie du mois courant. Cœur partagé entre :
 * — le bouton « Calculer la paie du mois » (creerRun: true, audité via userId) qui démarre le
 *   cycle en créant la PayrollRun ;
 * — le rafraîchissement AUTOMATIQUE au chargement de la page Paie (creerRun: false, silencieux) :
 *   les bulletins affichés reflètent ainsi toujours les dernières présences, heures, pointages,
 *   congés, primes et acomptes — sans jamais recréer un run ni toucher aux lignes validées/payées.
 * Renvoie false si aucun run n'existe (mode auto) — l'aperçu temps réel de la page s'en charge.
 */
export async function rafraichirPaieDuMois(opts: { creerRun: boolean; userId?: string }): Promise<boolean> {
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  // UNE transaction, la run du mois verrouillée FOR UPDATE AVANT de lire quoi que ce soit (revue
  // finale du 2026-09-24, point 4) : une écriture du planning en cours tient la run FOR SHARE
  // (planning-ecriture.ts), ce recalcul l'attend et lit le planning qu'elle a écrit ; une écriture
  // qui arrive pendant le recalcul l'attend à son tour. Sans ce verrou, le recalcul lisait un
  // planning sur le point de changer et écrivait des montants déjà faux. Même ordre que la
  // validation (run, puis lignes) : jamais d'interblocage entre eux.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${ATTENTE_VERROU_VALIDATION}'`);
    let runId: string;
    if (opts.creerRun) {
      const run = await tx.payrollRun.upsert({
        where: { mois_annee: { mois, annee } },
        update: { tauxChangeUtilise: config.tauxChangeCDF },
        create: { mois, annee, tauxChangeUtilise: config.tauxChangeCDF },
      });
      runId = run.id;
      await tx.$queryRaw`SELECT "id" FROM "public"."PayrollRun" WHERE "id" = ${runId} FOR UPDATE`;
    } else {
      const run = await tx.payrollRun.findUnique({ where: { mois_annee: { mois, annee } }, select: { id: true } });
      if (!run) return false;
      runId = run.id;
      await tx.$queryRaw`SELECT "id" FROM "public"."PayrollRun" WHERE "id" = ${runId} FOR UPDATE`;
      // Le recalcul utilise le taux de change COURANT : on le reflète sur le run.
      await tx.payrollRun.update({ where: { id: runId }, data: { tauxChangeUtilise: config.tauxChangeCDF } });
    }

    // Lignes déjà validées/payées : on ne les recalcule pas (bulletin émis non écrasable).
    const lignesFigees = await tx.payrollLine.findMany({
      where: { payrollRunId: runId, statutPaiement: { in: STATUTS_FIGES } },
      select: { employeeId: true },
    });
    const employeeIdsFiges = new Set(lignesFigees.map((l) => l.employeeId));

    // Calcul de tous les actifs (logique partagée avec l'aperçu temps réel de la page), DANS la
    // transaction : après le verrou, rien de ce qu'il lit ne peut plus être réécrit par le planning.
    const { lignes } = await calculerLignesPaie(mois, annee, tx);
    const nouvellesLignes = lignes
      .filter((l) => !employeeIdsFiges.has(l.employee.id))
      .map((l) => ({ payrollRunId: runId, employeeId: l.employee.id, ...l.data }));

    // NOTE (corrigé 2026-07-22, bug #1) : le solde « frais médicaux du mois » saisi sur la fiche
    // employé (Employee.fraisMedicauxMoisCourant) N'EST PLUS remis à zéro ici. Ce rafraîchissement
    // recalcule des lignes NON FIGÉES (brouillons) — qu'il soit déclenché par le bouton « Calculer »
    // (audité) ou SILENCIEUSEMENT à chaque ouverture de /paie (creerRun: false, sans audit). Remettre
    // le champ à zéro à cette étape faisait disparaître un montant saisi sur la fiche AVANT même que
    // la ligne ne soit validée, dès la prochaine ouverture de la page — perte d'argent silencieuse et
    // non tracée. La remise à zéro est désormais effectuée UNE SEULE FOIS, au moment où la ligne est
    // réellement finalisée (transition vers VALIDE, action délibérée et auditée) — voir
    // `appliquerTransitionPaie` dans `src/app/(app)/paie/actions.ts`. La table durable `FraisMedical`
    // (avec certificat, scopée par mois/année) n'est pas concernée : elle n'est jamais remise à zéro,
    // ses montants sont naturellement bornés au mois pour lequel ils ont été saisis.

    // Écriture en masse (remplace ~100 requêtes par ~4).
    await tx.payrollLine.deleteMany({
      where: { payrollRunId: runId, statutPaiement: { notIn: STATUTS_FIGES } },
    });
    await tx.payrollLine.createMany({ data: nouvellesLignes });
    // Journalisé uniquement quand l'action vient d'un utilisateur (bouton) — le rafraîchissement
    // automatique à l'affichage ne pollue pas le journal d'audit.
    if (opts.userId) {
      await tx.journalAudit.create({
        data: {
          entite: "PayrollRun",
          entiteId: runId,
          champ: "calcul",
          nouvelleValeur: `${nouvellesLignes.length} salaire(s) recalculé(s) — ${mois}/${annee}`,
          userId: opts.userId,
        },
      });
    }
    return true;
  }, { timeout: 60_000 });
}
