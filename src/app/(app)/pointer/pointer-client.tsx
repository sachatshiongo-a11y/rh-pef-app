"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { pointerArrivee, pointerDepart, saisirHoraireManuel, type ResultatPointage } from "./pointer-actions";

type PointageVue = { heureDebut: string; heureFin: string | null; pauseMinutes: number } | null;

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }); // UTC+1
const dureeH = (ms: number) => {
  const min = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
};

export function PointerClient({
  nom,
  photoUrl,
  dateLabel,
  pointage,
}: {
  nom: string;
  photoUrl: string | null;
  dateLabel: string;
  pointage: PointageVue;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [pause, setPause] = useState(30);
  const [manuel, setManuel] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const enCours = !!pointage && !pointage.heureFin;
  const termine = !!pointage && !!pointage.heureFin;

  // Compteur en direct pendant le service.
  useEffect(() => {
    if (!enCours || !pointage) return;
    const deb = new Date(pointage.heureDebut).getTime();
    const tick = () => setElapsed(Date.now() - deb);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enCours, pointage]);

  const run = (fn: () => Promise<ResultatPointage>) => {
    setErr(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.message ?? "Une erreur est survenue.");
      else router.refresh();
    });
  };

  const soumettreManuel = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saisirHoraireManuel(fd));
    setManuel(false);
  };

  const heuresNettes = termine && pointage
    ? Math.max(0, (new Date(pointage.heureFin!).getTime() - new Date(pointage.heureDebut).getTime()) / 3_600_000 - pointage.pauseMinutes / 60)
    : 0;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b bg-muted/40 px-5 py-4">
          <Avatar nom={nom} taille={44} photoUrl={photoUrl} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{nom}</p>
            <p className="text-sm capitalize text-muted-foreground">Pointer · {dateLabel}</p>
          </div>
        </div>

        <div className="p-5">
          {/* Cadran */}
          <div className="mb-5 flex flex-col items-center rounded-2xl border bg-background py-7">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {termine ? "Journée pointée" : enCours ? "Temps écoulé aujourd'hui" : "Aujourd'hui"}
            </span>
            <span className="mt-1 text-4xl font-bold tabular-nums">
              {termine ? `${heuresNettes.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h` : enCours ? dureeH(elapsed) : "0h 00m"}
            </span>
            {enCours && pointage && (
              <span className="mt-1 text-xs text-muted-foreground">Arrivée pointée à {hhmm(pointage.heureDebut)}</span>
            )}
            {termine && pointage && (
              <span className="mt-1 text-xs text-muted-foreground">
                {hhmm(pointage.heureDebut)} → {hhmm(pointage.heureFin!)} · pause {pointage.pauseMinutes} min
              </span>
            )}
          </div>

          {err && (
            <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
          )}

          {/* Actions selon l'état */}
          {!pointage && (
            <button
              onClick={() => run(pointerArrivee)}
              disabled={pending}
              className="w-full rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "…" : "→ Pointer l'arrivée"}
            </button>
          )}

          {enCours && (
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3 text-sm">
                <span className="font-medium">Ma pause du jour</span>
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={600}
                    step={5}
                    value={pause}
                    onChange={(e) => setPause(Math.max(0, Math.min(600, Number(e.target.value) || 0)))}
                    className="w-20 rounded-md border border-input bg-background px-2 py-1 text-right tabular-nums"
                  />
                  <span className="text-muted-foreground">min</span>
                </span>
              </label>
              <button
                onClick={() => {
                  const fd = new FormData();
                  fd.set("pauseMinutes", String(pause));
                  run(() => pointerDepart(fd));
                }}
                disabled={pending}
                className="w-full rounded-2xl border-2 border-primary py-4 text-base font-semibold text-primary transition hover:bg-primary/5 disabled:opacity-50"
              >
                {pending ? "…" : "■ Pointer le départ"}
              </button>
            </div>
          )}

          {termine && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ Journée enregistrée dans vos présences et vos heures.
            </div>
          )}
        </div>
      </div>

      {/* Horaire manuel (oubli) */}
      <div className="rounded-2xl border bg-card">
        <button
          onClick={() => setManuel((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium"
        >
          <span>+ Ajouter un horaire manuel (oubli)</span>
          <span className="text-muted-foreground">{manuel ? "−" : "+"}</span>
        </button>
        {manuel && (
          <form onSubmit={soumettreManuel} className="grid grid-cols-2 gap-3 border-t p-5">
            <label className="col-span-2 flex flex-col gap-1 text-xs">
              Jour
              <input name="date" type="date" required className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Arrivée
              <input name="heureDebut" type="time" required className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Départ
              <input name="heureFin" type="time" required className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs">
              Pause (minutes)
              <input name="pauseMinutes" type="number" min={0} max={600} step={5} defaultValue={30} className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <button type="submit" disabled={pending} className="col-span-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Enregistrer cet horaire
            </button>
          </form>
        )}
      </div>

      <p className="px-1 text-center text-xs text-muted-foreground">
        Votre pointage alimente automatiquement vos présences et vos heures — comme la pointeuse.
      </p>
    </div>
  );
}
