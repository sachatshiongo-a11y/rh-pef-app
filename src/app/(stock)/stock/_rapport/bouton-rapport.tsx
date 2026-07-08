"use client";

import { useRef, useState } from "react";

type T = { value: string; label: string };

// Bouton « Rapport » (menu déroulant) présent dans chaque onglet concerné : génère le rapport
// chiffré ou détaillé (PDF/Excel) sur la période choisie pour le(s) type(s) donné(s).
export function BoutonRapport({ types }: { types: T[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Le panneau (288px) s'ouvre vers la droite si la place le permet, sinon vers la gauche.
  // Évite qu'il passe sous la barre latérale quand le bouton se retrouve à gauche (retour à la ligne).
  const [alignRight, setAlignRight] = useState(false);
  const basculer = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setAlignRight(rect.left + 288 > window.innerWidth);
    setOpen((o) => !o);
  };
  const now = new Date();
  const finDef = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const debutDef = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const [debut, setDebut] = useState(debutDef);
  const [fin, setFin] = useState(finDef);
  const lien = (type: string, mode: string, format: string) => `/stock/rapports/export?type=${type}&mode=${mode}&format=${format}&debut=${debut}&fin=${fin}`;
  const inp = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm";
  const dl = "flex-1 rounded-md border px-2 py-1 text-center text-xs font-medium hover:border-primary hover:bg-accent";

  return (
    <div className="relative inline-block">
      <button ref={btnRef} onClick={basculer} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Rapport ▾</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute ${alignRight ? "right-0" : "left-0"} z-50 mt-1.5 w-72 overflow-hidden rounded-xl border bg-card shadow-xl`}>
            <div className="border-b bg-muted/40 px-4 py-2.5">
              <p className="text-sm font-semibold">Générer un rapport</p>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Du<input type="month" value={debut} onChange={(e) => setDebut(e.target.value)} className={inp} /></label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">Au<input type="month" value={fin} onChange={(e) => setFin(e.target.value)} className={inp} /></label>
              </div>

              {types.map((t) => (
                <div key={t.value} className="rounded-lg border p-2.5">
                  {types.length > 1 && <p className="mb-2 text-sm font-medium">{t.label}</p>}
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">Chiffré</span>
                    <a href={lien(t.value, "chiffre", "pdf")} download target="_blank" rel="noopener" className={dl}>PDF</a>
                    <a href={lien(t.value, "chiffre", "excel")} download className={dl}>Excel</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">Détaillé</span>
                    <a href={lien(t.value, "detail", "pdf")} download target="_blank" rel="noopener" className={dl}>PDF</a>
                    <a href={lien(t.value, "detail", "excel")} download className={dl}>Excel</a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
