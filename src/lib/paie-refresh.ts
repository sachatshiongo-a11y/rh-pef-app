import "server-only";
import { prisma } from "@/lib/prisma";
import { calculerLignesPaie } from "@/lib/paie-batch";
import { ATTENTE_VERROU_VALIDATION } from "@/lib/paie-validation";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import type { PaymentStatus, Prisma } from "@prisma/client";

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

    // L'HISTORIQUE DE PAIE NE DISPARAÎT JAMAIS (arbitrage Direction du 2026-10-01). Jusque-là, toutes
    // les lignes non figées étaient supprimées puis recréées : une ligne ROUVERTE par la Direction
    // (VALIDÉ → PAS_VALIDÉ) emportait en cascade ses bulletins émis (VersionBulletin) et ses
    // transitions (TransitionPaie), détachait son attestation et laissait sa signature et son journal
    // pointer dans le vide — au prochain recalcul, par un MANAGER ou à la simple ouverture de /paie.
    //   • Ligne AVEC historique (bulletin émis, transition, attestation, signature ou journal) : mise
    //     à jour EN PLACE — même identifiant, tout ce qui s'y rattache reste.
    //   • Brouillon SANS historique (calculé, jamais validé ni tracé) : remplacé comme avant. Rien
    //     d'enregistré n'y est attaché ; et son identifiant qui change garde la protection d'un écran
    //     périmé (`MESSAGE_LIGNE_RECALCULEE`, paie-validation.ts).
    // Les colonnes écrites sont EXACTEMENT celles d'une ligne recréée : les données du calcul, et le
    // paiement remis à vide (une ligne non figée n'est ni validée ni payée). Aucun montant ne change.
    // Une ligne avec historique dont le salarié n'est plus calculé (fiche désactivée) est laissée
    // telle quelle, jamais supprimée : seule la Direction efface une paie (`reinitialiserPaieDuMois`).
    const { existantes, aHistorique } = await lignesNonFigees(tx, runId);
    const conservees = new Map(existantes.filter(aHistorique).map((l) => [l.employeeId, l.id]));
    const brouillons = existantes.filter((l) => !aHistorique(l)).map((l) => l.id);

    if (brouillons.length) await tx.payrollLine.deleteMany({ where: { id: { in: brouillons } } });
    // Dans l'ordre des identifiants, comme les verrous de la validation : jamais d'interblocage.
    const enPlace = nouvellesLignes
      .filter((l) => conservees.has(l.employeeId))
      .sort((a, b) => conservees.get(a.employeeId)!.localeCompare(conservees.get(b.employeeId)!));
    for (const { payrollRunId: _run, employeeId, ...donnees } of enPlace) {
      await tx.payrollLine.update({ where: { id: conservees.get(employeeId)! }, data: { ...donnees, datePaiement: null, modePaiement: null, payeParId: null } });
    }
    // Écriture en masse des autres (remplace ~100 requêtes par ~4).
    await tx.payrollLine.createMany({ data: nouvellesLignes.filter((l) => !conservees.has(l.employeeId)) });
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

/**
 * Lignes NON figées d'une paie, et le prédicat « a un HISTORIQUE » : bulletin émis (VersionBulletin),
 * transition, attestation, signature BULLETIN ou journal. Une ligne qui a un historique n'est JAMAIS
 * supprimée — ni par le recalcul (mise à jour en place), ni par la réinitialisation (conservée, ses
 * bulletins remis restent en archive) : décisions de Sacha du 2026-10-01. Seul un brouillon sans
 * historique (rien d'enregistré n'y est rattaché) peut être remplacé.
 */
export async function lignesNonFigees(tx: Prisma.TransactionClient, runId: string) {
  const existantes = await tx.payrollLine.findMany({
    where: { payrollRunId: runId, statutPaiement: { notIn: STATUTS_FIGES } },
    select: { id: true, employeeId: true, _count: { select: { versionsBulletin: true, transitions: true, attestations: true } } },
  });
  const idsExistants = existantes.map((l) => l.id);
  const [signees, journalisees] = idsExistants.length
    ? await Promise.all([
        tx.signatureElectronique.findMany({ where: { cible: "BULLETIN", cibleId: { in: idsExistants } }, select: { cibleId: true } }),
        tx.journalAudit.findMany({ where: { entite: "PayrollLine", entiteId: { in: idsExistants } }, select: { entiteId: true }, distinct: ["entiteId"] }),
      ])
    : [[], []];
  const tracees = new Set([...signees.map((s) => s.cibleId), ...journalisees.map((j) => j.entiteId)]);
  const aHistorique = (l: (typeof existantes)[number]) =>
    l._count.versionsBulletin + l._count.transitions + l._count.attestations > 0 || tracees.has(l.id);
  return { existantes, aHistorique };
}

/**
 * Rafraîchissement À L'OUVERTURE d'un écran qui affiche les lignes de paie du mois courant — /paie et
 * « À valider » (correction 1, point 3) : une seule fonction, aucun écran ne recopie la règle. Si la
 * paie du mois a été calculée et qu'il reste des lignes non figées, elles sont recalculées AVANT
 * l'affichage : présences, heures, planning, congés, primes et acomptes saisis depuis s'y reflètent.
 * Ne crée jamais de run, ne touche jamais une ligne validée ou payée. Un échec ponctuel (réseau,
 * pooler, verrou tenu) n'empêche pas l'affichage : l'écran montre le dernier état calculé, et la
 * validation revérifie de toute façon chaque montant (paie-validation.ts).
 */
export async function rafraichirPaieAffichee(mois: number, annee: number): Promise<void> {
  const runMeta = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    select: { lignes: { select: { id: true, employeeId: true, statutPaiement: true } } },
  });
  if (!runMeta) return;
  // Seules les lignes qui COMPTENT déclenchent le recalcul : une ligne hors calcul (ligne rouverte
  // d'un salarié sorti du calcul, paie-hors-calcul.ts) n'est jamais recalculée. Sans ce filtre, une
  // paie CLÔTURÉE qui garde une ligne hors calcul était recalculée à chaque ouverture de /paie (taux
  // de change réécrit, ligne créée pour un salarié embauché après la clôture).
  const aRecalculer = (await lignesComptees(prisma, runMeta.lignes)).some((l) => !STATUTS_FIGES.includes(l.statutPaiement));
  if (!aRecalculer) return;
  try {
    await rafraichirPaieDuMois({ creerRun: false });
  } catch (e) {
    console.error("[paie] rafraîchissement automatique échoué :", e instanceof Error ? e.message : e);
  }
}
