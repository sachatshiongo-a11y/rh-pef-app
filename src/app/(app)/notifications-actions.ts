"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { MESSAGE_NOTIFICATION_REFUSEE, peutGererDomaine, peutToucherNotification } from "@/lib/acces-notification";

// Cloche des espaces RH et Stock (composant partagé `components/notification-bell.tsx`). Une Server
// Action ne passe par aucun layout : chaque action vérifie ELLE-MÊME le droit du compte sur l'objet
// (règles dans `lib/acces-notification.ts`). Un refus est RENDU comme valeur, jamais jeté : en
// production Next masquerait le message d'une exception.

export type ResultatNotification = { ok: true } | { erreur: string };

/** Marque comme lues les notifications d'un espace (RH ou STOCK) — réservé à cet espace. */
export async function marquerNotificationsLues(domaine: "RH" | "STOCK" = "RH"): Promise<ResultatNotification> {
  const user = await verifySession();
  const dom = domaine === "STOCK" ? "STOCK" : "RH";
  if (!peutGererDomaine(user, dom)) return { erreur: MESSAGE_NOTIFICATION_REFUSEE };
  // Les notifications personnelles d'un AUTRE compte (réponses à ses demandes) ne sont pas touchées.
  await prisma.notification.updateMany({ where: { domaine: dom, lu: false, OR: [{ destinataireUserId: null }, { destinataireUserId: user.id }] }, data: { lu: true } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Supprime une notification (quand on clique dessus, elle disparaît) — si elle est dans l'espace du compte. */
export async function supprimerNotification(id: string): Promise<ResultatNotification> {
  const user = await verifySession();
  const n = await prisma.notification.findUnique({
    where: { id: String(id) },
    select: { id: true, domaine: true, destinataireUserId: true },
  });
  // Même réponse pour « inexistante » et « pas à vous » : rien ne se devine.
  if (!n || !peutToucherNotification(user, n)) return { erreur: MESSAGE_NOTIFICATION_REFUSEE };
  // Le filtre reprend le domaine et le destinataire LUS : une ligne modifiée entre-temps n'est pas touchée.
  await prisma.notification.deleteMany({ where: { id: n.id, domaine: n.domaine, destinataireUserId: n.destinataireUserId } });
  revalidatePath("/", "layout");
  return { ok: true };
}
