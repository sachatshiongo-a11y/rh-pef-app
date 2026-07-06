"use server";

import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";

/** Enregistre l'abonnement push de l'appareil courant pour l'utilisateur connecté. */
export async function enregistrerPush(sub: { endpoint: string; p256dh: string; auth: string }) {
  const user = await verifySession();
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return;
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId: user.id, p256dh: sub.p256dh, auth: sub.auth },
    create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
  });
}

/** Supprime l'abonnement push d'un appareil (désactivation des notifications). */
export async function supprimerPush(endpoint: string) {
  await verifySession();
  if (!endpoint) return;
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}
