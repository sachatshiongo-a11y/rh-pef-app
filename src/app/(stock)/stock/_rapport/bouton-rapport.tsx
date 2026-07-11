"use client";

import { useRef, useState } from "react";

type T = { value: string; label: string };

// Menu « Exporter ▾ » unique : regroupe les exports immédiats de la vue (PDF/Excel) et les
// rapports sur période (chiffré/détaillé), au lieu d'aligner 3-5 boutons dans chaque en-tête.
export function BoutonRapport({ types, pdfHref, excelHref, pdfDownload }: { types?: T[]; pdfHref?: string; excelHref?: string; pdfDownload?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // Position calculée à l'ouverture et CLAMPÉE au viewport : le panneau reste toujours
  // entièrement à l'écran, même sur téléphone où il ne tiendrait ni à gauche ni à droite.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const basculer = () => {
    if (open) { setOpen(false); return; }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const marge = 8;
      const width = Math.min(288, window.innerWidth - 2 * marge);
      const left = Math.min(Math.max(marge, rect.right - width), window.innerWidth - width - marge);
      setPos({ top: rect.bottom + 6, left, width });
    }
    setOpen(true);
  };
  const now = new Date();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const finDef = iso(now);
  const debutDef = iso(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())));
  const [debut, setDebut] = useState(debutDef);
  const [fin, setFin] = useState(finDef);
  const lien = (type: string, mode: string, format: string) => `/stock/rapports/export?type=${type}&mode=${mode}&format=${format}&debut=${debut}&fin=${fin}`;
  const inp = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm";
  const dl = "flex-1 rounded-md border px-2 py-1 text-center text-xs font-medium hover:border-primary hover:bg-accent";

  if (!types?.length && !pdfHref && !excelHref) return null;

  return (
    <div className="inline-block">
      <button ref={btnRef} onClick={basculer} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{types?.length ? "Exporter / Rapports ▾" : "Exporter ▾"}</button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 max-h-[80vh] overflow-y-auto rounded-xl border bg-card shadow-xl"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            <div className="border-b bg-muted/40 px-4 py-2.5">
              <p className="text-sm font-semibold">Exporter</p>
            </div>
            <div className="space-y-3 p-4">
              {(pdfHref || excelHref) && (
                <div className="rounded-lg border p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">Cette vue</span>
                    {pdfHref && (pdfDownload
                      ? <a href={pdfHref} download className={dl} onClick={() => setOpen(false)}>PDF</a>
                      : <a href={pdfHref} target="_blank" rel="noopener" className={dl} onClick={() => setOpen(false)}>PDF</a>)}
                    {excelHref && <a href={excelHref} download className={dl} onClick={() => setOpen(false)}>Excel</a>}
                  </div>
                </div>
              )}

              {!!types?.length && (
                <>
                  <p className="text-xs font-medium text-muted-foreground">Rapport sur période</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">Du<input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} className={inp} /></label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">Au<input type="date" value={fin} onChange={(e) => setFin(e.target.value)} className={inp} /></label>
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
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
