import "server-only";

import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { endpointPushAutorise } from "@/lib/push-services";

const hoteDe = (u: string) => { try { return new URL(u).host; } catch { return "(adresse illisible)"; } };

// Configuration VAPID (clé publique côté client, clé privée SECRÈTE côté serveur). Si les clés
// sont absentes, l'envoi est un no-op (comme l'e-mail) — la cloche in-app continue de fonctionner.
let configure = false;
function pretPush(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configure) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:sachatshiongo@patesenfolie.cd",
      pub,
      priv,
    );
    configure = true;
  }
  return true;
}

/**
 * Envoie une notification push aux appareils abonnés des utilisateurs donnés. Ne lève jamais ;
 * supprime automatiquement les abonnements périmés (404/410).
 */
export async function envoyerPush(
  userIds: string[],
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<void> {
  if (!pretPush() || userIds.length === 0) return;
  const tous = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  // Un abonnement enregistré avant le contrôle des services (lib/push-services.ts) vers une adresse
  // inconnue n'est JAMAIS appelé ; il est signalé au journal, pas effacé en silence.
  const subs = tous.filter((s) => {
    if (endpointPushAutorise(s.endpoint)) return true;
    console.error("[push] abonnement ignoré : service push non reconnu", { id: s.id, userId: s.userId, hote: hoteDe(s.endpoint) });
    return false;
  });
  if (subs.length === 0) return;

  const data = JSON.stringify(payload);
  const perimes: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) perimes.push(s.endpoint);
        else console.error("[push] échec d'envoi :", code, e instanceof Error ? e.message : e);
      }
    }),
  );
  if (perimes.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: perimes } } });
  }
}
