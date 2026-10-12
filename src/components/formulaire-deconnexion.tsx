"use client";

import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import { supprimerPush } from "@/app/(app)/push-actions";
import { oublierAbonnementPush } from "@/lib/oublier-abonnement-push";

/**
 * Formulaire de DÉCONNEXION, le seul de l'application : retire d'abord l'abonnement aux
 * notifications de CET appareil (lib/oublier-abonnement-push.ts), puis ferme la session.
 */
export function FormulaireDeconnexion({ children, className }: { children: ReactNode; className?: string }) {
  async function deconnecter() {
    await oublierAbonnementPush({
      abonnementCourant: async () => {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
        const reg = await navigator.serviceWorker.getRegistration();
        return (await reg?.pushManager?.getSubscription()) ?? null;
      },
      supprimerCoteServeur: supprimerPush,
    });
    await logout();
  }
  return (
    <form action={deconnecter} className={className}>
      {children}
    </form>
  );
}
