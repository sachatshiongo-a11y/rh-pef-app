"use client";

import Link from "next/link";
import { useState } from "react";
import { marquerNotificationsLues, supprimerNotification } from "@/app/(app)/notifications-actions";
import type { NotificationItem } from "@/lib/notifications";
import { DOMAINES_CLOCHE, LIBELLE_DOMAINE_CLOCHE, type DomaineCloche } from "@/lib/acces-notification";

/** L'étiquette d'espace d'une notification (RH, Stock, Exploitation) ; rien pour un domaine inconnu. */
function etiquetteEspace(domaine: string | undefined): string | null {
  return DOMAINES_CLOCHE.includes(domaine as DomaineCloche) ? LIBELLE_DOMAINE_CLOCHE[domaine as DomaineCloche] : null;
}

function ilYA(date: Date): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

/**
 * LA cloche, la même dans les espaces RH, Stock et Exploitation : les notifications de tous les espaces du compte,
 * chacune avec son étiquette d'espace ; le chiffre est le total des non lues ; « Tout marquer lu » vaut pour tout ce
 * que le compte voit (le serveur ne touche que ses domaines).
 */
export function NotificationBell({
  items,
  nonLues,
  nonLuesListees,
  cloture,
}: {
  items: NotificationItem[];
  nonLues: number;
  /** Combien de non lues la liste montre : inférieur à `nonLues` seulement au-delà du plafond de sécurité (annoncé). */
  nonLuesListees?: number;
  cloture: { message: string; jours: number } | null;
}) {
  const [ouvert, setOuvert] = useState(false);
  const total = nonLues + (cloture ? 1 : 0);
  // Rien n'est caché en silence : si le plafond de sécurité coupe la liste, la cloche le dit.
  const tronquee = nonLuesListees !== undefined && nonLuesListees < nonLues;

  return (
    <div className="relative">
      <button
        onClick={() => setOuvert((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border hover:bg-accent"
        aria-label="Notifications"
        title={tronquee ? `Notifications : ${nonLuesListees} affichées sur ${nonLues} non lues` : "Notifications"}
      >
        {/* Cloche (SVG, pas d'emoji) */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {total > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          {/* Mobile : feuille pleine largeur ancrée en haut ; ordinateur : menu déroulant ancré à droite. */}
          <div className="fixed inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-50 overflow-hidden rounded-xl border bg-card shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">Notifications</span>
              {nonLues > 0 && (
                <button
                  onClick={() => {
                    marquerNotificationsLues();
                    setOuvert(false);
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Tout marquer lu
                </button>
              )}
            </div>

            {tronquee && (
              <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900" data-testid="cloche-plafond">
                {nonLuesListees} affichées sur {nonLues} non lues.
              </p>
            )}

            <ul className="max-h-96 divide-y overflow-y-auto">
              {cloture && (
                <li className="bg-amber-50 px-4 py-3">
                  <p className="text-sm font-medium text-amber-900">{cloture.message}</p>
                  <Link href="/paie" onClick={() => setOuvert(false)} className="text-xs text-amber-800 underline">
                    Ouvrir la paie →
                  </Link>
                </li>
              )}
              {items.length === 0 && !cloture && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune notification.</li>
              )}
              {items.map((n) => {
                const espace = etiquetteEspace(n.domaine);
                const contenu = (
                  <div className={`px-4 py-3 ${n.lu ? "" : "bg-primary/5"}`}>
                    <p className="text-sm">{n.message}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      {espace && <span className="rounded-full border px-1.5 py-px text-[10px] font-medium leading-4">{espace}</span>}
                      {ilYA(n.createdAt)}
                    </p>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.lien ? (
                      <Link href={n.lien} onClick={() => { void supprimerNotification(n.id); setOuvert(false); }} className="block hover:bg-accent/50">
                        {contenu}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => void supprimerNotification(n.id)} className="block w-full text-left hover:bg-accent/50">
                        {contenu}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
