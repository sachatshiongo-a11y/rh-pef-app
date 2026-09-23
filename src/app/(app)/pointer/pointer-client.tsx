"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { ScannerAffiche } from "@/components/pointage/scanner-affiche";
import { heureKinshasa } from "@/lib/heure-kinshasa";
import { saisirHoraireManuel, type ResultatPointage } from "./pointer-actions";

// L'écran « Pointer » : l'état du jour (cadran) et le SCANNER de l'affiche. Plus aucun bouton
// « Pointer mon arrivée / mon départ » : on ne pointe qu'en scannant l'affiche du restaurant
// (docs/superpowers/specs/2026-09-23-pointage-qr-design.md, §7).

type PointageVue = { heureDebut: string; heureFin: string | null; pauseMinutes: number } | null;

const hhmm = (iso: string) => heureKinshasa(new Date(iso));
const dureeH = (ms: number) => {
  const min = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
};

export function PointerClient({
  nom,
  photoUrl,
  dateLabel,
  pointage,
  departScanne,
}: {
  nom: string;
  photoUrl: string | null;
  dateLabel: string;
  pointage: PointageVue;
  /** Instant ISO du départ SCANNÉ dont la pause n'est pas encore saisie (null sinon). */
  departScanne: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [manuel, setManuel] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const enCours = !!pointage && !pointage.heureFin;
  const termine = !!pointage && !!pointage.heureFin;
  const pauseAttendue = enCours && !!departScanne;
  // Le scanner n'est monté que si la journée restait à pointer À L'OUVERTURE : il ne disparaît
  // donc pas sous les yeux du salarié quand son départ vient d'être validé (l'écran de confirmation
  // et l'éventuel avertissement de position restent affichés), et la caméra ne s'ouvre jamais
  // pour une journée déjà complète.
  const [scannerOuvert] = useState(!termine);

  // Compteur en direct pendant le service ; figé à l'heure du départ scanné.
  useEffect(() => {
    if (!enCours || !pointage || departScanne) return;
    const deb = new Date(pointage.heureDebut).getTime();
    const tick = () => setElapsed(Date.now() - deb);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [enCours, pointage, departScanne]);
  const ecoule = pauseAttendue && pointage
    ? new Date(departScanne!).getTime() - new Date(pointage.heureDebut).getTime()
    : elapsed;

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

        <div className="space-y-5 p-5">
          {/* Le scan de l'affiche : le SEUL chemin pour pointer. */}
          {scannerOuvert && <ScannerAffiche />}

          {/* Cadran */}
          <div className="flex flex-col items-center rounded-2xl border bg-background py-7">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {termine ? "Journée pointée" : pauseAttendue ? "Départ scanné, pause à saisir" : enCours ? "Temps écoulé aujourd'hui" : "Aujourd'hui"}
            </span>
            <span className="mt-1 text-4xl font-bold tabular-nums">
              {termine ? `${heuresNettes.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h` : enCours ? dureeH(ecoule) : "0h 00m"}
            </span>
            {enCours && pointage && (
              <span className="mt-1 text-xs text-muted-foreground">
                Arrivée pointée à {hhmm(pointage.heureDebut)}
                {departScanne && ` · départ scanné à ${hhmm(departScanne)}`}
              </span>
            )}
            {pauseAttendue && (
              <span className="mt-2 px-4 text-center text-xs text-muted-foreground">
                Scannez de nouveau l&apos;affiche pour saisir votre pause et clore la journée.
              </span>
            )}
            {termine && pointage && (
              <span className="mt-1 text-xs text-muted-foreground">
                {hhmm(pointage.heureDebut)} → {hhmm(pointage.heureFin!)} · pause {pointage.pauseMinutes} min
              </span>
            )}
          </div>

          {err && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>
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
