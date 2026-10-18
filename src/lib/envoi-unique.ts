import "server-only";

import { prisma } from "@/lib/prisma";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";

/**
 * UN SEUL ENVOI PAR PÉRIODE pour les courriels planifiés (rappels RH et Stock du jour, rapports du mois).
 *
 * Pourquoi : GitHub Actions lance les tâches planifiées avec des heures de retard, et la Direction ajoute un second
 * déclencheur précis (cron-job.org) : la même route peut être appelée deux fois le même jour, parfois en même temps.
 *
 * Mémoire SANS migration : une ligne du journal d'audit (`JournalAudit`, entité « EnvoiPlanifie », entiteId = la clé
 * de la période, ex. « rappels-2026-10-19 »).
 *  - champ « reserve » : un envoi est EN COURS (réservation de 10 min au plus, effacée si l'envoi échoue ou n'a rien
 *    à envoyer) ;
 *  - champ « envoye »  : l'envoi a RÉUSSI — c'est le seul marqueur qui bloque les appels suivants.
 * La réservation et la lecture se font dans une courte transaction protégée par un verrou consultatif Postgres
 * (`pg_advisory_xact_lock`) : deux appels simultanés passent l'un après l'autre, le second voit la réservation du
 * premier et n'envoie pas. L'envoi lui-même a lieu HORS transaction (il peut durer 15 s et plus).
 * Un échec n'écrit aucun marqueur « envoye » : le réessai (GitHub, cron-job.org, bouton manuel) renvoie.
 */

export const ENTITE_ENVOI = "EnvoiPlanifie";
/** Une réservation plus vieille que cela est tenue pour abandonnée (instance coupée en plein envoi). */
export const DUREE_RESERVATION_MS = 10 * 60_000;

export type Marqueur = "reserve" | "envoye";

/** Clé du jour civil de Kinshasa : « rappels-2026-10-19 ». */
export const cleJour = (prefixe: string, maintenant: Date = new Date()) => `${prefixe}-${jourCourantKinshasaISO(maintenant)}`;

/** Ce que la route répondra si l'envoi a eu lieu (ou a été tenté). */
export type ReponseCron = { corps: Record<string, unknown>; status: number };
export type ResultatEnvoiUnique = { dejaEnvoye: false; resultat: ReponseCron } | { dejaEnvoye: true; enCours: boolean };

/**
 * Exécute `travail` si la période `cle` n'a pas déjà été envoyée (ou si `forcer`). `travail` renvoie `reussi: true`
 * seulement si un courriel a été ENVOYÉ avec succès ; sinon (échec, ou rien à envoyer) rien n'est mémorisé.
 */
export async function envoiUnique(
  cle: string,
  options: { forcer?: boolean },
  travail: () => Promise<{ reussi: boolean; resultat: ReponseCron }>,
): Promise<ResultatEnvoiUnique> {
  const reservation = await reserver(cle, options.forcer === true);
  if (reservation.statut === "deja") return { dejaEnvoye: true, enCours: false };
  if (reservation.statut === "en-cours") return { dejaEnvoye: true, enCours: true };

  let sortie: { reussi: boolean; resultat: ReponseCron };
  try {
    sortie = await travail();
  } catch (e) {
    await liberer(reservation.id);
    throw e;
  }
  if (sortie.reussi) await confirmer(reservation.id, options.forcer === true);
  else await liberer(reservation.id);
  return { dejaEnvoye: false, resultat: sortie.resultat };
}

type Reservation = { statut: "ok"; id: string | null } | { statut: "deja" } | { statut: "en-cours" };

async function reserver(cle: string, forcer: boolean): Promise<Reservation> {
  return prisma.$transaction(async (tx) => {
    // Verrou tenu jusqu'à la fin de CETTE transaction (courte) : les appels simultanés font la queue ici.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ENTITE_ENVOI}:${cle}`}))`;
    const lignes = await tx.journalAudit.findMany({ where: { entite: ENTITE_ENVOI, entiteId: cle }, select: { id: true, champ: true, date: true } });
    const maintenant = Date.now();
    if (!forcer && lignes.some((l) => l.champ === "envoye")) return { statut: "deja" } as const;
    if (lignes.some((l) => l.champ === "reserve" && maintenant - l.date.getTime() < DUREE_RESERVATION_MS)) return { statut: "en-cours" } as const;

    // Réservations abandonnées : nettoyées.
    const perimees = lignes.filter((l) => l.champ === "reserve").map((l) => l.id);
    if (perimees.length > 0) await tx.journalAudit.deleteMany({ where: { id: { in: perimees } } });
    // … y compris celles d'AUTRES périodes (la clé change chaque jour : une instance coupée en plein envoi laisserait sinon
    // une ligne « reserve » orpheline à jamais dans le journal).
    await tx.journalAudit.deleteMany({ where: { entite: ENTITE_ENVOI, champ: "reserve", date: { lt: new Date(maintenant - DUREE_RESERVATION_MS) } } });

    // JournalAudit exige un auteur : le premier compte Direction actif. Sans aucun, personne ne reçoit de courriel
    // de toute façon : on envoie sans mémoire plutôt que de bloquer.
    const auteur = await tx.user.findFirst({ where: { role: "ADMIN", actif: true }, select: { id: true }, orderBy: { id: "asc" } });
    if (!auteur) return { statut: "ok", id: null } as const;
    const creee = await tx.journalAudit.create({
      data: { entite: ENTITE_ENVOI, entiteId: cle, champ: "reserve", nouvelleValeur: libelle("reserve", forcer), userId: auteur.id },
      select: { id: true },
    });
    return { statut: "ok", id: creee.id } as const;
  }, { timeout: 15_000, maxWait: 15_000 });
}

/**
 * Le texte lu dans l'export Excel du journal d'audit (réservé à la Direction). L'« utilisateur » de la ligne est le premier
 * compte Direction actif, imposé par la table : il n'a RIEN fait — le libellé le dit en toutes lettres.
 */
function libelle(etat: Marqueur, forcer: boolean): string {
  const quoi = etat === "envoye" ? "Courriel planifié ENVOYÉ" : "Envoi de courriel planifié EN COURS";
  return `${quoi}${forcer ? " (renvoi forcé)" : ""} par le serveur — trace automatique (un seul envoi par période) ; l'utilisateur indiqué n'a effectué aucune action`;
}

async function confirmer(id: string | null, forcer: boolean) {
  if (!id) return;
  await prisma.journalAudit.update({ where: { id }, data: { champ: "envoye", nouvelleValeur: libelle("envoye", forcer), date: new Date() } }).catch((e) => {
    console.error("[envoi-unique] marqueur « envoyé » non écrit (un second appel pourrait renvoyer) :", e instanceof Error ? e.message : e);
  });
}

async function liberer(id: string | null) {
  if (!id) return;
  await prisma.journalAudit.deleteMany({ where: { id } }).catch(() => {});
}
