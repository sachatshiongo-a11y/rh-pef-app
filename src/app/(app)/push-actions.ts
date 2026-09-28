"use server";

import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { MESSAGE_PUSH_REFUSE, peutReprendreAbonnement } from "@/lib/acces-notification";

// Abonnements Web Push (bouton « Notifications » des coquilles RH et salarié). Une Server Action ne
// passe par aucun layout : chaque action vérifie que l'abonnement appartient au compte (règle dans
// `lib/acces-notification.ts`). Un refus est RENDU comme valeur : le bouton se désabonne quand même
// côté navigateur, et l'abonnement orphelin d'un autre compte est purgé au premier envoi (404/410).

export type ResultatPush = { ok: true } | { erreur: string };

const texte = (v: unknown) => (typeof v === "string" ? v : "");

/** Enregistre l'abonnement push de l'appareil courant pour l'utilisateur connecté. */
export async function enregistrerPush(sub: { endpoint: string; p256dh: string; auth: string }): Promise<ResultatPush> {
  const user = await verifySession();
  const endpoint = texte(sub?.endpoint);
  const cles = { p256dh: texte(sub?.p256dh), auth: texte(sub?.auth) };
  if (!endpoint || !cles.p256dh || !cles.auth) return { erreur: "Abonnement incomplet." };

  const existant = await prisma.pushSubscription.findUnique({
    where: { endpoint },
    select: { userId: true, p256dh: true, auth: true },
  });
  if (!peutReprendreAbonnement(existant, user.id, cles)) return { erreur: MESSAGE_PUSH_REFUSE };

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: user.id, ...cles },
    create: { userId: user.id, endpoint, ...cles },
  });
  return { ok: true };
}

/** Supprime l'abonnement push d'un appareil (désactivation des notifications) — le sien seulement. */
export async function supprimerPush(endpoint: string): Promise<ResultatPush> {
  const user = await verifySession();
  const e = texte(endpoint);
  if (!e) return { erreur: "Abonnement incomplet." };
  const existant = await prisma.pushSubscription.findUnique({ where: { endpoint: e }, select: { userId: true } });
  if (!existant) return { ok: true }; // déjà parti : l'état voulu est atteint
  if (existant.userId !== user.id) return { erreur: MESSAGE_PUSH_REFUSE };
  await prisma.pushSubscription.deleteMany({ where: { endpoint: e, userId: user.id } });
  return { ok: true };
}
