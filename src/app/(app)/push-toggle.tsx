"use client";

import { useEffect, useState } from "react";
import { enregistrerPush, supprimerPush } from "./push-actions";
import { estErreur } from "@/lib/action-lisible";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// Convertit la clé publique VAPID (base64url) en Uint8Array pour l'API PushManager.
function base64ToUint8(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type Etat = "chargement" | "non-supporte" | "refuse" | "actif" | "inactif" | "occupe";

export function PushToggle() {
  const [etat, setEtat] = useState<Etat>("chargement");
  // Refus du serveur (service push inconnu, abonnement d'un autre compte) : dit à l'écran, au lieu d'afficher « activées » à tort.
  const [refus, setRefus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let annule = false;
    // Détection asynchrone (pas de setState synchrone dans l'effet → pas de rendu en cascade).
    const detecter = async (): Promise<Etat> => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !VAPID_PUBLIC) return "non-supporte";
      if (Notification.permission === "denied") return "refuse";
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        return (await reg.pushManager.getSubscription()) ? "actif" : "inactif";
      } catch {
        return "non-supporte";
      }
    };
    detecter().then((e) => { if (!annule) setEtat(e); });
    return () => { annule = true; };
  }, []);

  async function activer() {
    setRefus(null);
    setEtat("occupe");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setEtat(perm === "denied" ? "refuse" : "inactif");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8(VAPID_PUBLIC),
      });
      const json = sub.toJSON();
      const r = await enregistrerPush({ endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth });
      if (estErreur(r)) {
        // Rien n'est enregistré côté serveur : l'abonnement du navigateur est retiré pour ne pas laisser un état à moitié actif.
        await sub.unsubscribe().catch(() => false);
        setRefus(r.erreur);
        setEtat("inactif");
        return;
      }
      setEtat("actif");
    } catch {
      setEtat("inactif");
    }
  }

  async function desactiver() {
    setRefus(null);
    setEtat("occupe");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const r = await supprimerPush(sub.endpoint);
        // Le navigateur se désabonne dans tous les cas (le serveur n'enverra plus rien à un compte qui n'est pas le sien) ; le refus est dit.
        if (estErreur(r)) setRefus(r.erreur);
        await sub.unsubscribe();
      }
      setEtat("inactif");
    } catch {
      setEtat("actif");
    }
  }

  if (etat === "chargement" || etat === "non-supporte") return null;

  if (etat === "refuse") {
    return (
      <p className="px-2 text-[11px] text-muted-foreground">
        🔔 Notifications bloquées (à réactiver dans les réglages du navigateur/téléphone).
      </p>
    );
  }

  const actif = etat === "actif";
  return (
    <>
    <button
      type="button"
      onClick={actif ? desactiver : activer}
      disabled={etat === "occupe"}
      className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-60 ${
        actif ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {etat === "occupe" ? "🔔 …" : actif ? "🔔 Notifications activées" : "🔕 Activer les notifications"}
    </button>
    {refus && <p role="alert" className="px-2 pt-1 text-[11px] text-destructive">{refus}</p>}
    </>
  );
}
