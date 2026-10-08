"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Rangée d'onglets (des liens) qui défile de côté sur téléphone au lieu de se couper ou de passer à
 * la ligne : l'onglet actif est ramené dans la vue à l'ouverture — sans cela, le dernier onglet
 * restait hors écran et invisible quand il était actif. Sur ordinateur, les onglets gardent leur
 * boîte compacte d'origine. 44 px de haut sur téléphone. L'onglet actif est recentré aussi quand il
 * CHANGE sans rechargement (sommaire d'une page qui suit le défilement, `SommaireSections`).
 */
export function OngletsDefilants({ onglets, libelle }: { onglets: { href: string; label: string; actif: boolean }[]; libelle: string }) {
  const rangee = useRef<HTMLDivElement>(null);
  const hrefActif = onglets.find((o) => o.actif)?.href;
  useEffect(() => {
    const zone = rangee.current;
    const actif = zone?.querySelector<HTMLElement>('[aria-current="page"]');
    // On règle le défilement de la rangée elle-même (jamais scrollIntoView : il ferait aussi défiler la page).
    if (zone && actif) zone.scrollLeft = actif.offsetLeft - (zone.clientWidth - actif.offsetWidth) / 2;
  }, [hrefActif]);
  return (
    <div ref={rangee} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <nav aria-label={libelle} className="flex w-max min-w-full overflow-hidden rounded-lg border text-sm font-medium sm:w-fit sm:min-w-0">
        {onglets.map((o) => (
          <Link
            key={o.href} href={o.href} aria-current={o.actif ? "page" : undefined}
            className={`flex min-h-11 flex-auto shrink-0 items-center justify-center whitespace-nowrap border-l px-4 py-2.5 text-center first:border-l-0 sm:min-h-0 sm:flex-none sm:px-3 sm:py-1.5 ${o.actif ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {o.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
