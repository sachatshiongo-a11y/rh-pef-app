"use client";

import Link from "next/link";
import { useState } from "react";
import { marquerNotificationsLues } from "@/app/(app)/notifications-actions";
import type { NotificationItem } from "@/lib/notifications";

function ilYA(date: Date): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

export function NotificationBell({
  items,
  nonLues,
  cloture,
}: {
  items: NotificationItem[];
  nonLues: number;
  cloture: { message: string; jours: number } | null;
}) {
  const [ouvert, setOuvert] = useState(false);
  const total = nonLues + (cloture ? 1 : 0);

  return (
    <div className="relative">
      <button
        onClick={() => setOuvert((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border hover:bg-accent"
        aria-label="Notifications"
        title="Notifications"
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
          <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border bg-card shadow-lg">
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
                const contenu = (
                  <div className={`px-4 py-3 ${n.lu ? "" : "bg-primary/5"}`}>
                    <p className="text-sm">{n.message}</p>
                    <p className="text-xs text-muted-foreground">{ilYA(n.createdAt)}</p>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.lien ? (
                      <Link href={n.lien} onClick={() => setOuvert(false)} className="block hover:bg-accent/50">
                        {contenu}
                      </Link>
                    ) : (
                      contenu
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
