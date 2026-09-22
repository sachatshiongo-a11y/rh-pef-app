"use client";

import { useRef, useState } from "react";

/**
 * LE CADRE DE SIGNATURE — on trace au doigt, on obtient un PNG.
 *
 * `touch-action: none` sur le canvas : sans lui, le geste fait défiler la page au lieu de tracer
 * (constaté sur téléphone). Le tracé est exporté à 2× pour rester net à l'impression, sur fond
 * TRANSPARENT (il se pose sur la ligne de signature du document).
 *
 * Le composant ne décide de rien : il rend un PNG. Qui signe, quand, et dans quel mode sont
 * décidés par la garde serveur — jamais ici.
 */
export function CadreSignature({
  onSigner,
  enCours,
  bandeau,
}: {
  onSigner: (pngDataUrl: string) => void;
  enCours: boolean;
  bandeau?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dernier = useRef<{ x: number; y: number } | null>(null);
  const [points, setPoints] = useState(0);

  const contexte = () => {
    const c = ref.current;
    if (!c) return null;
    // Taille RÉELLE du canvas = taille CSS × 2 (netteté). Fixée à la première interaction, quand
    // la boîte de dialogue a sa largeur définitive.
    if (c.width === 0) {
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * 2);
      c.height = Math.round(r.height * 2);
    }
    const ctx = c.getContext("2d");
    if (ctx) { ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827"; }
    return ctx;
  };

  const position = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 };
  };

  const debut = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    contexte();
    dernier.current = position(e);
    setPoints((n) => n + 1);
  };

  const trace = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dernier.current) return;
    const ctx = contexte();
    if (!ctx) return;
    const p = position(e);
    ctx.beginPath();
    ctx.moveTo(dernier.current.x, dernier.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dernier.current = p;
    setPoints((n) => n + 1);
  };

  const fin = () => { dernier.current = null; };

  const effacer = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setPoints(0);
  };

  return (
    <div className="space-y-3">
      {bandeau && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{bandeau}</p>}
      <canvas
        ref={ref}
        onPointerDown={debut}
        onPointerMove={(e) => e.buttons === 1 && trace(e)}
        onPointerUp={fin}
        onPointerLeave={fin}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-input bg-background"
        aria-label="Cadre de signature — tracez votre signature avec le doigt"
      />
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={effacer} disabled={enCours} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
          Effacer
        </button>
        <button
          type="button"
          disabled={enCours || points < 8}
          onClick={() => { const c = ref.current; if (c) onSigner(c.toDataURL("image/png")); }}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {enCours ? "Enregistrement…" : "Signer"}
        </button>
      </div>
      {points > 0 && points < 8 && <p className="text-xs text-muted-foreground">Tracez votre signature dans le cadre.</p>}
    </div>
  );
}
