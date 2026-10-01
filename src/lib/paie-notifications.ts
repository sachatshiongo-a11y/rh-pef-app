import "server-only";

// « LA DIRECTION VALIDE, LA RH PAIE ENSUITE » (décision de Sacha du 2026-10-01) : chacune apprend
// que l'autre a fait sa part.
//  - la Direction valide → chaque compte RH (MANAGER) actif : « N bulletins de <mois> validés — à
//    payer », lien vers « À valider » (section « Bulletins à payer ») ;
//  - la RH paie → chaque compte Direction (ADMIN) actif : « N bulletins de <mois> payés le <date> —
//    <total versé> » ;
//  - la RH clôture la paie du mois → la Direction : « Paie de <mois> clôturée par <nom> ».
// L'auteur du geste n'est jamais notifié de son propre geste.
// Notifications de la cloche RH ADRESSÉES (destinataireUserId) : la RH ne voit pas celles de la
// Direction ni l'inverse, et un compte Consultation n'en voit aucune. Push sur les appareils des
// mêmes comptes. Appelées APRÈS la transaction : un échec (base, push) est consigné, jamais relancé —
// le bulletin est bel et bien validé ou payé, l'écran ne doit pas dire le contraire.
import { prisma } from "@/lib/prisma";
import { envoyerPush } from "@/lib/push";
import { MOIS_FR } from "@/lib/dates-fr";
import { jourKinshasa } from "@/lib/heure-kinshasa";
import { formaterUSD } from "@/lib/montant";
import { totalVerseUSD } from "@/lib/paie-net";

/** « septembre 2026 » — le mois de la paie (PayrollRun), jamais celui de l'horloge. */
export const libelleMoisPaie = (mois: number, annee: number) => `${MOIS_FR[mois - 1]} ${annee}`;

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Message à la RH après une validation (pur, testé). `enAttente` = validés du mois restant à payer. */
export function messageBulletinsAPayer(n: number, mois: number, annee: number, enAttente: number): string {
  const base = `${pluriel(n, "bulletin")} de ${libelleMoisPaie(mois, annee)} ${n > 1 ? "validés" : "validé"} — à payer`;
  return enAttente > n ? `${base} (${enAttente} en attente de paiement)` : base;
}

/** Message à la Direction après un paiement par la RH (pur, testé). */
export function messageBulletinsPayes(n: number, mois: number, annee: number, date: Date, totalUSD: number): string {
  return `${pluriel(n, "bulletin")} de ${libelleMoisPaie(mois, annee)} ${n > 1 ? "payés" : "payé"} le ${jourKinshasa(date)} — ${formaterUSD(totalUSD)}`;
}

/** Message à la Direction quand la RH clôture (pur, testé). La RH ne clôture qu'une paie déjà
 *  entièrement validée : rien n'est validé par sa clôture ; les lignes hors calcul laissées de côté
 *  sont dites. */
export function messageClotureParRH(mois: number, annee: number, nom: string, horsCalcul: number): string {
  const base = `Paie de ${libelleMoisPaie(mois, annee)} clôturée par ${nom}`;
  return horsCalcul > 0 ? `${base} — ${horsCalcul} ligne(s) hors calcul laissée(s) de côté` : base;
}

/** Sujet « à payer » d'une paie : une seule notification non lue par compte RH (remplacée, pas empilée). */
export const refAPayer = (payrollRunId: string) => `paie-a-payer:${payrollRunId}`;

// « Paie » est dans le menu de la RH (onglet « Payer les bulletins ») ; « À valider » ne l'est pas.
const LIEN_A_PAYER = "/paie";
const LIEN_PAYES = "/paie";

async function comptesActifs(role: "ADMIN" | "MANAGER", sauf?: string): Promise<string[]> {
  return (await prisma.user.findMany({ where: { role, actif: true, ...(sauf ? { id: { not: sauf } } : {}) }, select: { id: true } })).map((u) => u.id);
}

/** Cloche RH adressée à chaque compte + push. `remplacer` : la notification NON LUE du même sujet
 *  (refId) est remplacée par celle-ci, pour ne pas empiler « 1 bulletin validé » vingt fois. */
async function notifierComptes(userIds: string[], p: { message: string; lien: string; refId: string; remplacer?: boolean }) {
  if (userIds.length === 0) return;
  const message = p.message.slice(0, 480);
  await prisma.$transaction([
    ...(p.remplacer ? [prisma.notification.deleteMany({ where: { domaine: "RH", refId: p.refId, destinataireUserId: { in: userIds }, lu: false } })] : []),
    prisma.notification.createMany({ data: userIds.map((id) => ({ domaine: "RH", destinataireUserId: id, type: "AUTRE", message, lien: p.lien, refId: p.refId })) }),
  ]);
  await envoyerPush(userIds, { title: "Pâtes en Folie", body: message.slice(0, 180), url: p.lien, tag: p.refId });
}

/** Lignes réellement passées, regroupées par paie (mois) : une notification par mois concerné. */
async function parPaie(payrollLineIds: string[]) {
  const lignes = await prisma.payrollLine.findMany({
    where: { id: { in: [...new Set(payrollLineIds)] } },
    select: { payrollRunId: true, salNetUSD: true, transportUSD: true, payrollRun: { select: { mois: true, annee: true } } },
  });
  const groupes = new Map<string, typeof lignes>();
  for (const l of lignes) (groupes.get(l.payrollRunId) ?? groupes.set(l.payrollRunId, []).get(l.payrollRunId)!).push(l);
  return [...groupes.entries()];
}

/** Effet après commit : jamais d'exception vers l'action (l'écriture a réussi). */
async function sansEchec(quoi: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[paie] notification « ${quoi} » en échec (le bulletin est bien enregistré) :`, e);
  }
}

/** Après une VALIDATION (ligne, lot, clôture) : la RH sait quoi payer. `auteurId` : pas notifié. */
export async function notifierBulletinsValides(payrollLineIds: string[], auteurId?: string): Promise<void> {
  if (payrollLineIds.length === 0) return;
  await sansEchec("bulletins à payer", async () => {
    const rh = await comptesActifs("MANAGER", auteurId);
    if (rh.length === 0) return;
    for (const [runId, lignes] of await parPaie(payrollLineIds)) {
      const enAttente = await prisma.payrollLine.count({ where: { payrollRunId: runId, statutPaiement: "VALIDE" } });
      const { mois, annee } = lignes[0].payrollRun;
      await notifierComptes(rh, { message: messageBulletinsAPayer(lignes.length, mois, annee, enAttente), lien: LIEN_A_PAYER, refId: refAPayer(runId), remplacer: true });
    }
  });
}

/**
 * Après un PAIEMENT : si c'est la RH qui a payé, la Direction est prévenue (nombre, date, total
 * versé). Dans tous les cas, quand plus rien n'est à payer dans le mois, le rappel « à payer » non lu
 * de la RH disparaît (il annoncerait un travail déjà fait).
 */
export async function notifierBulletinsPayes(payrollLineIds: string[], payeur: { role: string }, datePaiement: Date): Promise<void> {
  if (payrollLineIds.length === 0) return;
  await sansEchec("bulletins payés", async () => {
    const groupes = await parPaie(payrollLineIds);
    const direction = payeur.role === "MANAGER" ? await comptesActifs("ADMIN") : [];
    for (const [runId, lignes] of groupes) {
      const { mois, annee } = lignes[0].payrollRun;
      if (direction.length > 0) {
        // Date : l'instant du paiement passé par l'action (celui écrit sur les lignes), jamais relu.
        const total = lignes.reduce((s, l) => s + totalVerseUSD(l), 0);
        await notifierComptes(direction, { message: messageBulletinsPayes(lignes.length, mois, annee, datePaiement, total), lien: LIEN_PAYES, refId: `paie-payes:${runId}` });
      }
      await retirerRappelSansObjet(runId);
    }
  });
}

/** Le rappel « à payer » non lu de la RH disparaît quand plus rien n'est validé à payer dans le mois. */
async function retirerRappelSansObjet(runId: string) {
  const restants = await prisma.payrollLine.count({ where: { payrollRunId: runId, statutPaiement: "VALIDE" } });
  if (restants === 0) await prisma.notification.deleteMany({ where: { domaine: "RH", refId: refAPayer(runId), lu: false } });
}

/** Après une RÉOUVERTURE (Direction) : un rappel « à payer » devenu sans objet disparaît. */
export async function retirerRappelSiRienAPayer(payrollLineIds: string[]): Promise<void> {
  if (payrollLineIds.length === 0) return;
  await sansEchec("rappel à payer", async () => {
    for (const [runId] of await parPaie(payrollLineIds)) await retirerRappelSansObjet(runId);
  });
}

/** Message à la RH quand la Direction annule un paiement (pur, testé). */
export function messagePaiementAnnule(n: number, mois: number, annee: number): string {
  return `Paiement annulé par la Direction : ${pluriel(n, "bulletin")} de ${libelleMoisPaie(mois, annee)} à payer de nouveau`;
}

/** Après une ANNULATION DE PAIEMENT (Direction) : le bulletin redevient payable, la RH le sait. */
export async function notifierPaiementAnnule(payrollLineIds: string[], auteurId: string): Promise<void> {
  if (payrollLineIds.length === 0) return;
  await sansEchec("paiement annulé", async () => {
    const rh = await comptesActifs("MANAGER", auteurId);
    if (rh.length === 0) return;
    for (const [runId, lignes] of await parPaie(payrollLineIds)) {
      const { mois, annee } = lignes[0].payrollRun;
      // Même sujet que le rappel « à payer » : il le remplace, et disparaît quand plus rien n'est à payer.
      await notifierComptes(rh, { message: messagePaiementAnnule(lignes.length, mois, annee), lien: LIEN_A_PAYER, refId: refAPayer(runId), remplacer: true });
    }
  });
}

/** Après une CLÔTURE faite par la RH : la Direction est prévenue (qui, et les lignes laissées de côté). */
export async function notifierClotureParRH(p: { payrollRunId: string; nom: string; horsCalcul: number }): Promise<void> {
  await sansEchec("paie clôturée", async () => {
    const direction = await comptesActifs("ADMIN");
    if (direction.length === 0) return;
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: p.payrollRunId }, select: { mois: true, annee: true } });
    await notifierComptes(direction, { message: messageClotureParRH(run.mois, run.annee, p.nom, p.horsCalcul), lien: LIEN_PAYES, refId: `paie-cloture:${p.payrollRunId}` });
  });
}
