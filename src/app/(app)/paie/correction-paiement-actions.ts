"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { formulaireLisible } from "@/lib/erreur-formulaire";
import { journaliser } from "@/lib/audit";
import { DELAI_VALIDATION_PAIE, messageErreurValidation, ValidationPaieRefuseeError, verrouillerLignesPaie } from "@/lib/paie-validation";
import { VERROU_CLOTURE_EXPLOITATION } from "@/lib/exploitation/cloture";
import { rangMois } from "@/lib/exploitation/cloture-regles";
import { jourDuVersement } from "@/lib/date-paiement";
import { reinitialiserCacheAValider } from "@/lib/a-valider-chargeurs";
import {
  changementPaiement,
  commentaireCorrection,
  lireDateCorrection,
  lireModeCorrection,
  lireMotifCorrection,
  MESSAGE_CORRECTION_BULLETIN_NON_PAYE,
  MESSAGE_RIEN_A_CORRIGER,
  messageCorrectionMoisExploitationClos,
  moisDuJour,
  paiementDeLigne,
  texteValeurPaiement,
} from "@/lib/correction-paiement";

/**
 * CORRIGER LE PAIEMENT d'un bulletin PAYÉ — la date de versement et le moyen de paiement, de n'importe quel mois
 * (clôturé compris), par la Direction SEULE. Le motif est obligatoire. Décision de la Direction du 2026-10-12 : annuler
 * un paiement n'est plus possible hors du mois en cours (`appliquerTransitionPaie`), mais une date ou un moyen mal saisi
 * doit pouvoir se corriger partout.
 *
 * Ce qui ne bouge JAMAIS : l'état (le bulletin reste Payé), les montants, le taux figé, les totaux du mois, les déclarations,
 * la signature (l'empreinte d'un bulletin ne contient ni la date ni le moyen : voir lib/correction-paiement.ts), `payeParId`
 * (celui qui a PAYÉ reste celui qui a payé ; l'auteur de la correction est dans la trace).
 *
 * Mêmes contrôles de date que « Marquer payé » : obligatoire ici, jamais dans le futur, pas avant le 1er du mois de la
 * paie. Exploitation : le rapprochement lit la date de versement (« paie versée du mois ») mais aucune écriture du journal
 * de caisse n'en dépend ; une date qui ferait passer le paiement d'un mois d'Exploitation à un autre alors que l'un des deux
 * est CLÔTURÉ est refusée (le chiffre d'un mois clos ne bouge pas en silence).
 *
 * Tracée à la ligne d'historique du bulletin (`TransitionPaie` Payé → Payé : auteur, date, motif, avant → après) ET au journal
 * d'audit (`PayrollLine` / `correctionPaiement`). Tout ou rien : une seule transaction, ligne verrouillée.
 */
export async function corrigerPaiementBulletin(payrollLineId: string, formData: FormData) {
  return formulaireLisible("/employes", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const mode = lireModeCorrection(formData.get("modePaiement"));
    const motif = lireMotifCorrection(formData.get("motif"));
    const maintenant = new Date(); // l'instant du geste : fixe « aujourd'hui » (Kinshasa) pour la date

    let employeeId: string;
    try {
      employeeId = await prisma.$transaction(async (tx) => {
        await verrouillerLignesPaie(tx, [payrollLineId]); // attente bornée : un paiement ou une annulation concurrent se termine d'abord
        const ligne = await tx.payrollLine.findUnique({ where: { id: payrollLineId }, include: { payrollRun: true } });
        if (!ligne) throw new Error("Bulletin introuvable.");
        if (ligne.statutPaiement !== "PAYE") throw new Error(MESSAGE_CORRECTION_BULLETIN_NON_PAYE);

        const jour = lireDateCorrection(formData.get("datePaiement"), { mois: ligne.payrollRun.mois, annee: ligne.payrollRun.annee }, maintenant);
        const avant = paiementDeLigne(ligne);
        const apres = { jour, mode };
        const c = changementPaiement(avant, apres);
        if (!c.dateChangee && !c.modeChange) throw new Error(MESSAGE_RIEN_A_CORRIGER);

        // Exploitation : seulement si la date change de MOIS (dans un même mois, la paie versée de ce mois ne bouge pas).
        if (c.dateChangee) {
          const mois = [avant.jour ? moisDuJour(avant.jour) : null, moisDuJour(jour)].filter((m): m is { annee: number; mois: number } => m !== null);
          const memeMois = avant.jour !== null && rangMois(mois[0].annee, mois[0].mois) === rangMois(mois[1].annee, mois[1].mois);
          if (!memeMois) {
            const rangs = [...new Set(mois.map((m) => rangMois(m.annee, m.mois)))].sort((a, b) => a - b);
            for (const rang of rangs) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${VERROU_CLOTURE_EXPLOITATION}::int, ${rang}::int)`;
            const clos = await tx.clotureExploitation.findMany({ where: { OR: mois.map((m) => ({ annee: m.annee, mois: m.mois })) }, select: { annee: true, mois: true }, orderBy: [{ annee: "asc" }, { mois: "asc" }] });
            if (clos.length > 0) throw new ValidationPaieRefuseeError(messageCorrectionMoisExploitationClos(clos[0], avant.jour, jour));
          }
        }

        // Seuls la date et le moyen sont écrits : ni l'état, ni un montant, ni le taux figé, ni `payeParId`.
        await tx.payrollLine.update({
          where: { id: payrollLineId },
          data: { ...(c.dateChangee ? { datePaiement: jourDuVersement(jour) } : {}), ...(c.modeChange ? { modePaiement: mode } : {}) },
        });
        await tx.transitionPaie.create({
          data: {
            payrollLineId,
            deStatut: "PAYE",
            versStatut: "PAYE",
            userId: user.id,
            modePaiement: mode,
            commentaire: commentaireCorrection(avant, apres, motif),
          },
        });
        await journaliser(tx, {
          entite: "PayrollLine",
          entiteId: payrollLineId,
          champ: "correctionPaiement",
          ancienneValeur: texteValeurPaiement(avant),
          nouvelleValeur: `${texteValeurPaiement(apres)} — motif : ${motif}`,
          userId: user.id,
        });
        return ligne.employeeId;
      }, { timeout: DELAI_VALIDATION_PAIE });
    } catch (e) {
      const refus = messageErreurValidation(e);
      throw refus ? new ValidationPaieRefuseeError(refus) : e;
    }

    reinitialiserCacheAValider();
    revalidatePath(`/employes/${employeeId}`);
    revalidatePath("/a-valider");
    revalidatePath("/paie");
    revalidatePath("/exploitation");
  }, formData);
}
