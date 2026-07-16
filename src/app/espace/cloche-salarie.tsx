"use client";

import Link from "next/link";
import { useState } from "react";
import { marquerMesNotificationsLues, supprimerMaNotification } from "./actions";
import type { NotificationItem } from "@/lib/notifications";

function ilYA(date: Date): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

/** Cloche personnelle du salarié (mêmes codes visuels que la cloche RH/Stock, actions scopées). */
export function ClocheSalarie({ items, nonLues }: { items: NotificationItem[]; nonLues: number }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOuvert((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border hover:bg-accent"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {nonLues > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {nonLues > 9 ? "9+" : nonLues}
          </span>
        )}
      </button>

      {ouvert && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOuvert(false)} />
          {/* Mobile : feuille pleine largeur ancrée en haut (respecte l'encoche) ; ordinateur : menu déroulant ancré à droite. */}
          <div className="fixed inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-50 overflow-hidden rounded-xl border bg-card shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="text-sm font-semibold">Notifications</span>
              {nonLues > 0 && (
                <button onClick={() => { void marquerMesNotificationsLues(); setOuvert(false); }} className="text-xs text-primary hover:underline">
                  Tout marquer lu
                </button>
              )}
            </div>

            <ul className="max-h-96 divide-y overflow-y-auto">
              {items.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune notification.</li>
              )}
              {items.map((n) => {
                const contenu = (
                  <div className={`px-4 py-3 ${n.lu ? "" : "bg-primary/5"}`}>
                    <p className="text-sm">{n.message}</p>
                    <p className="text-xs text-muted-foreground">{ilYA(n.createdAt)}</p>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.lien ? (
                      <Link href={n.lien} onClick={() => { void supprimerMaNotification(n.id); setOuvert(false); }} className="block hover:bg-accent/50">
                        {contenu}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => void supprimerMaNotification(n.id)} className="block w-full text-left hover:bg-accent/50">
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
