"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Sélection multiple réutilisable (cases à cocher + barre d'actions). */
export function useBulkSelection() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  return {
    sel,
    ids: [...sel],
    toggle: (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    clear: () => setSel(new Set()),
    setAll: (ids: string[], on: boolean) => setSel(on ? new Set(ids) : new Set()),
  };
}

/** Publie la hauteur d'une barre COLLANTE de page dans `--hauteur-barre-actions`, sur son parent : l'en-tête
 *  de colonnes du tableau voisin (`en-tete-collante`, globals.css) se colle alors juste SOUS elle, au lieu
 *  de passer derrière. À poser sur toute barre `sticky colle-sous-entete` qui précède un tableau ; sans
 *  barre, la variable est absente et le repli est 0px. Renvoie la `ref` à mettre sur la barre ;
 *  `presente` = false quand la barre n'est rendue que sous condition (ex. à la sélection). */
export function useHauteurBarreCollante<T extends HTMLElement = HTMLDivElement>(presente = true) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const barre = ref.current;
    if (!presente) return;
    const parent = barre?.parentElement;
    if (!barre || !parent) return;
    const publier = () => parent.style.setProperty("--hauteur-barre-actions", `${barre.offsetHeight}px`);
    publier();
    const obs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(publier) : null;
    obs?.observe(barre);
    return () => {
      obs?.disconnect();
      parent.style.removeProperty("--hauteur-barre-actions");
    };
  }, [presente]);
  return ref;
}

/** Barre collante « Tout sélectionner · N sélectionné(s) · [actions] » : sous l'en-tête de la coquille sur
 *  téléphone (`colle-sous-entete`). N'affiche les actions
 *  qu'à la sélection → aucune surcharge visuelle quand rien n'est coché.
 *  Liste PAGINÉE : `total` = lignes de la page, `cochesAffichees` = cochées parmi elles (la case d'en-tête
 *  suit la page) et `count` reste le nombre total de cochées, toutes pages ; `libelleTout` nomme la case. */
export function BulkBar({ count, total, onAll, cochesAffichees, libelleTout = "Tout sélectionner", children }: {
  count: number; total: number; onAll: (on: boolean) => void; cochesAffichees?: number; libelleTout?: string; children?: React.ReactNode;
}) {
  const ref = useHauteurBarreCollante();
  const coches = cochesAffichees ?? count;
  return (
    <div ref={ref} className="sticky colle-sous-entete z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={total > 0 && coches === total}
          ref={(el) => { if (el) el.indeterminate = coches > 0 && coches < total; }}
          onChange={(e) => onAll(e.target.checked)}
        />
        {libelleTout}
      </label>
      <span className="text-sm text-muted-foreground">{count} sélectionné(s)</span>
      {count > 0 && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
