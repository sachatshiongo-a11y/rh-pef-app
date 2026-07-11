"use client";

import { useEffect, useState } from "react";

/**
 * Bandeau « Nouvelle version disponible » : compare la version de build embarquée à celle du
 * serveur (/api/version), toutes les 5 minutes et au retour sur l'app (PWA rouverte). Fini les
 * rafraîchissements forcés après chaque déploiement.
 */
export function MajBanner({ version }: { version: string }) {
  const [nouvelle, setNouvelle] = useState(false);

  useEffect(() => {
    if (!version || version === "dev") return; // pas de bandeau en développement
    let arret = false;
    const verifier = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { v } = (await r.json()) as { v: string };
        if (!arret && v && v !== "dev" && v !== version) setNouvelle(true);
      } catch { /* hors-ligne : on réessaiera */ }
    };
    const surRetour = () => { if (document.visibilityState === "visible") verifier(); };
    const timer = setInterval(verifier, 5 * 60_000);
    document.addEventListener("visibilitychange", surRetour);
    window.addEventListener("focus", surRetour);
    return () => { arret = true; clearInterval(timer); document.removeEventListener("visibilitychange", surRetour); window.removeEventListener("focus", surRetour); };
  }, [version]);

  if (!nouvelle) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center gap-3 border-t bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg" style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}>
      <span>✨ Une nouvelle version de l&apos;application est disponible.</span>
      <button onClick={() => window.location.reload()} className="rounded-md bg-white/90 px-3 py-1 font-semibold text-primary hover:bg-white">
        Recharger
      </button>
    </div>
  );
}
