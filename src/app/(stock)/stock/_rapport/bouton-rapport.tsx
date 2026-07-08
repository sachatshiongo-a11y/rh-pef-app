"use client";

import { useState } from "react";

type T = { value: string; label: string };

// Bouton « Rapport » (menu déroulant) présent dans chaque onglet concerné : génère le rapport
// chiffré ou détaillé (PDF/Excel) sur les 12 derniers mois pour le(s) type(s) donné(s).
export function BoutonRapport({ types }: { types: T[] }) {
  const [open, setOpen] = useState(false);
  const now = new Date();
  const fin = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const debut = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const lien = (type: string, mode: string, format: string) => `/stock/rapports/export?type=${type}&mode=${mode}&format=${format}&debut=${debut}&fin=${fin}`;
  const lienCls = "rounded border px-2 py-0.5 text-xs font-medium hover:bg-accent";

  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Rapport ▾</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-60 rounded-lg border bg-card p-3 text-sm shadow-lg">
            <p className="mb-2 text-xs text-muted-foreground">Sur les 12 derniers mois</p>
            {types.map((t) => (
              <div key={t.value} className="mb-2 last:mb-0">
                {types.length > 1 && <p className="mb-1 font-medium">{t.label}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Chiffré :</span>
                  <a href={lien(t.value, "chiffre", "pdf")} download target="_blank" rel="noopener" className={lienCls}>PDF</a>
                  <a href={lien(t.value, "chiffre", "excel")} download className={lienCls}>Excel</a>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Détaillé :</span>
                  <a href={lien(t.value, "detail", "pdf")} download target="_blank" rel="noopener" className={lienCls}>PDF</a>
                  <a href={lien(t.value, "detail", "excel")} download className={lienCls}>Excel</a>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
