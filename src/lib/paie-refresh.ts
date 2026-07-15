import "server-only";
import { prisma } from "@/lib/prisma";
import { calculerLignesPaie } from "@/lib/paie-batch";
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

  let runId: string;
  if (opts.creerRun) {
    const run = await prisma.payrollRun.upsert({
      where: { mois_annee: { mois, annee } },
      update: { tauxChangeUtilise: config.tauxChangeCDF },
      create: { mois, annee, tauxChangeUtilise: config.tauxChangeCDF },
    });
    runId = run.id;
  } else {
    const run = await prisma.payrollRun.findUnique({ where: { mois_annee: { mois, annee } } });
    if (!run) return false;
    runId = run.id;
    // Le recalcul utilise le taux de change COURANT : on le reflète sur le run.
    await prisma.payrollRun.update({ where: { id: runId }, data: { tauxChangeUtilise: config.tauxChangeCDF } });
  }

  // Lignes déjà validées/payées : on ne les recalcule pas (bulletin émis non écrasable).
  const lignesFigees = await prisma.payrollLine.findMany({
    where: { payrollRunId: runId, statutPaiement: { in: STATUTS_FIGES } },
    select: { employeeId: true },
  });
  const employeeIdsFiges = new Set(lignesFigees.map((l) => l.employeeId));

  // Calcul en mémoire de tous les actifs (logique partagée avec l'aperçu temps réel de la page).
  const { lignes, employesFraisMedicaux: fraisTous } = await calculerLignesPaie(mois, annee);
  const nouvellesLignes = lignes
    .filter((l) => !employeeIdsFiges.has(l.employee.id))
    .map((l) => ({ payrollRunId: runId, employeeId: l.employee.id, ...l.data }));
  // On ne remet à zéro le solde « frais médicaux » que des lignes réellement (ré)écrites.
  const employesFraisMedicaux = fraisTous.filter((id) => !employeeIdsFiges.has(id));

  // Écriture en masse dans une transaction (remplace ~100 requêtes par ~4).
  await prisma.$transaction(
    [
    prisma.payrollLine.deleteMany({
      where: { payrollRunId: runId, statutPaiement: { notIn: STATUTS_FIGES } },
    }),
    prisma.payrollLine.createMany({ data: nouvellesLignes }),
    prisma.employee.updateMany({
      where: { id: { in: employesFraisMedicaux } },
      data: { fraisMedicauxMoisCourant: 0 },
    }),
    // Journalisé uniquement quand l'action vient d'un utilisateur (bouton) — le rafraîchissement
    // automatique à l'affichage ne pollue pas le journal d'audit.
    ...(opts.userId
      ? [
          prisma.journalAudit.create({
            data: {
              entite: "PayrollRun",
              entiteId: runId,
              champ: "calcul",
              nouvelleValeur: `${nouvellesLignes.length} salaire(s) recalculé(s) — ${mois}/${annee}`,
              userId: opts.userId,
            },
          }),
        ]
      : []),
    ],
    { timeout: 60_000 }
  );

  return true;
}
