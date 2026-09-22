"use client";

import { useEffect, useRef, useState } from "react";

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
  // Rectangle CSS du canvas, capturé une fois au pointerdown et réutilisé pendant tout le
  // geste : évite un getBoundingClientRect() (recalcul de mise en page synchrone) à chaque
  // pointermove, sensible sur un téléphone d'entrée de gamme.
  const rectRef = useRef<DOMRect | null>(null);
  const [points, setPoints] = useState(0);
  // Miroir de `points` lisible depuis le callback du ResizeObserver sans recréer l'observateur
  // à chaque tracé (setPoints seul obligerait à reconnecter l'observateur à chaque point).
  const pointsRef = useRef(0);

  const majPoints = (n: number) => {
    pointsRef.current = n;
    setPoints(n);
  };

  const appliquerReglagesTrait = (ctx: CanvasRenderingContext2D) => {
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  };

  // Le <canvas> a une taille intrinsèque par défaut de 300×150 tant qu'on ne lui fixe pas
  // width/height explicitement (ce n'est PAS 0×0) : sans ce redimensionnement, le bitmap
  // resterait figé à 300×150 pendant que la boîte CSS fait h-40 w-full — export flou, et tout
  // point au-delà d'environ 150px CSS tomberait hors bitmap, non dessiné, en silence. On
  // redimensionne donc à chaque changement de taille observé (au montage, et si la boîte de
  // dialogue change de largeur) — mais seulement si `points === 0` : changer width/height
  // efface le bitmap, et on ne veut surtout pas détruire un tracé en cours parce que le clavier
  // du téléphone s'est ouvert ou que la mise en page a légèrement bougé.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const observer = new ResizeObserver((entries) => {
      if (pointsRef.current !== 0) return;
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      c.width = Math.round(width * 2);
      c.height = Math.round(height * 2);
      const ctx = c.getContext("2d");
      if (ctx) appliquerReglagesTrait(ctx);
    });
    observer.observe(c);
    return () => observer.disconnect();
  }, []);

  const contexte = () => {
    const c = ref.current;
    if (!c) return null;
    const ctx = c.getContext("2d");
    if (ctx) appliquerReglagesTrait(ctx);
    return ctx;
  };

  const position = (e: React.PointerEvent<HTMLCanvasElement>, r: DOMRect) => {
    const c = e.currentTarget;
    const ratio = c.width / r.width;
    return { x: (e.clientX - r.left) * ratio, y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const debut = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = contexte();
    const r = e.currentTarget.getBoundingClientRect();
    rectRef.current = r;
    if (!ctx) return;
    dernier.current = position(e, r);
    majPoints(pointsRef.current + 1);
  };

  const trace = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dernier.current || !rectRef.current) return;
    const ctx = contexte();
    if (!ctx) return;
    const p = position(e, rectRef.current);
    ctx.beginPath();
    ctx.moveTo(dernier.current.x, dernier.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dernier.current = p;
    majPoints(pointsRef.current + 1);
  };

  const fin = () => { dernier.current = null; };

  const effacer = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    majPoints(0);
  };

  return (
    <div className="space-y-3">
      {bandeau && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{bandeau}</p>}
      <canvas
        ref={ref}
        onPointerDown={debut}
        onPointerMove={(e) => e.buttons === 1 && trace(e)}
        onPointerUp={fin}
        onPointerCancel={fin}
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
