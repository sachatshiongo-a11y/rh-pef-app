"use client";

import Link from "next/link";
import { Icone } from "@/components/icones";
import type { EntreeBarre } from "@/lib/navigation-espaces";

/**
 * Hauteur réservée sous le contenu des coquilles « écran fixe » (RH, Stock, Exploitation : un
 * conteneur `h-dvh` dont le <main> défile). En la posant sur ce conteneur, la zone qui défile
 * s'arrête au-dessus de la barre : rien ne peut passer dessous, pas même un élément `sticky
 * bottom-0` (pied de tableau, barre d'actions). 4rem = h-16 des boutons, 1px = la bordure du haut.
 */
export const RESERVE_BARRE_DU_BAS = "pb-[calc(4rem+1px+env(safe-area-inset-bottom))] lg:pb-0";

/**
 * Barre de navigation du bas — téléphone et tablette (sous `lg`), installé ou dans le navigateur.
 * UN SEUL composant pour tous les espaces (salarié, RH, Stock, Exploitation) : quatre écrans du
 * quotidien + « Menu », qui ouvre le tiroir complet de l'espace. Sur ordinateur, elle disparaît
 * (le menu est ouvert en permanence à gauche).
 *
 * `position: fixed` SANS `backdrop-filter` ni fond translucide : les deux ensemble la font
 * décrocher pendant le défilement en PWA iOS (piège déjà rencontré). Marges de sécurité en bas
 * (barre d'accueil de l'iPhone) et sur les côtés (paysage).
 */
export function BarreDuBas({
  entrees,
  estActif,
  menuOuvert,
  onMenu,
  menuId,
}: {
  entrees: EntreeBarre[];
  /** La règle d'état actif de l'espace (la même que son menu). */
  estActif: (href: string) => boolean;
  menuOuvert: boolean;
  onMenu: () => void;
  /** `id` du tiroir que « Menu » ouvre (aria-controls). */
  menuId: string;
}) {
  return (
    <nav
      aria-label="Navigation principale"
      data-barre-du-bas
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:hidden"
    >
      {/* minmax(0, 1fr) : une colonne ne s'élargit jamais pour un libellé, pas de débordement à 375 px. */}
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${entrees.length + 1}, minmax(0, 1fr))` }}>
        {entrees.map((l) => {
          const actif = estActif(l.href);
          const badge = l.badge ?? 0;
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={actif ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 px-0.5 text-xs font-medium ${actif ? "text-primary" : "text-muted-foreground"}`}
              >
                <span className={`relative flex h-7 w-12 items-center justify-center rounded-full ${actif ? "bg-primary/10" : ""}`}>
                  <Icone nom={l.icone} taille={20} />
                  {badge > 0 && (
                    <span
                      data-badge
                      className="absolute -top-1 right-0 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-none text-white"
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{l.court}</span>
                {badge > 0 && <span className="sr-only"> ({badge})</span>}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMenu}
            aria-expanded={menuOuvert}
            aria-controls={menuId}
            className="flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
          >
            <span className="flex h-7 w-12 items-center justify-center rounded-full">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </span>
            Menu
          </button>
        </li>
      </ul>
    </nav>
  );
}
