"use client";

import Link from "next/link";
import { useId, useState, type MouseEvent, type ReactNode } from "react";

/**
 * Téléphone : le sélecteur de semaine sur UNE ligne (← semaine →) et un bouton « Plus » qui déplie
 * ce qui est secondaire — filtres, exports, options —, sur le modèle de l'Inventaire. Le panneau
 * (`children`, rendu côté serveur) se referme dès qu'on touche un lien. `filtre` : un filtre actif
 * reste visible, avec son lien pour le retirer. Invisible dès `lg` (le haut de page d'origine reste).
 */
export function BarreSemaineMobile({ precedente, suivante, libelle, filtre, children }: {
  precedente: string; suivante: string; libelle: string;
  filtre?: { libelle: string; retirer: string };
  children: ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  const idPanneau = useId();
  // Un lien (ou un bouton marqué `data-ferme-plus`) referme le panneau ; l'ouverture d'un menu d'export, non.
  const fermerSurLien = (e: MouseEvent) => { if ((e.target as HTMLElement).closest("a, [data-ferme-plus]")) setOuvert(false); };
  const bouton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border hover:bg-accent";
  return (
    <div data-barre-semaine="" className="space-y-2 lg:hidden">
      <div className="flex items-center gap-2 text-sm">
        <Link href={precedente} aria-label="Semaine précédente" className={bouton}>←</Link>
        <span className="min-w-0 flex-1 truncate text-center font-medium">{libelle}</span>
        <Link href={suivante} aria-label="Semaine suivante" className={bouton}>→</Link>
        <button
          type="button" onClick={() => setOuvert((v) => !v)} aria-expanded={ouvert} aria-controls={idPanneau}
          aria-label={filtre ? `Plus d'options — filtre ${filtre.libelle}` : "Plus d'options"}
          className={`relative inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border px-3 font-medium ${ouvert ? "border-primary bg-primary/10" : ""}`}
        >
          Plus <span aria-hidden className="text-[10px]">{ouvert ? "▲" : "▼"}</span>
          {filtre && <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500" />}
        </button>
      </div>
      {filtre && (
        <p className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-sm">
          <span className="min-w-0 truncate">Filtre : <span className="font-medium">{filtre.libelle}</span></span>
          <Link href={filtre.retirer} className="flex min-h-11 shrink-0 items-center font-medium underline underline-offset-2">Retirer</Link>
        </p>
      )}
      {ouvert && (
        <div id={idPanneau} data-plus-mobile="" onClick={fermerSurLien} className="space-y-3 rounded-xl border bg-muted/30 p-3 text-sm">
          {children}
        </div>
      )}
    </div>
  );
}
