"use client";

import { useState } from "react";

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

/** Barre collante « Tout sélectionner · N sélectionné(s) · [actions] ». N'affiche les actions
 *  qu'à la sélection → aucune surcharge visuelle quand rien n'est coché. */
export function BulkBar({ count, total, onAll, children }: { count: number; total: number; onAll: (on: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={total > 0 && count === total}
          ref={(el) => { if (el) el.indeterminate = count > 0 && count < total; }}
          onChange={(e) => onAll(e.target.checked)}
        />
        Tout sélectionner
      </label>
      <span className="text-sm text-muted-foreground">{count} sélectionné(s)</span>
      {count > 0 && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
