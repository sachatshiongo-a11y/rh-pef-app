"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/avatar";
import { ScannerAffiche } from "@/components/pointage/scanner-affiche";
import { heureKinshasa } from "@/lib/heure-kinshasa";
import { libellePause } from "@/lib/pointage-qr";
import type { PointageDuJour } from "./pointage-du-jour";

// L'écran « Pointer » : l'état du jour (cadran) et le SCANNER de l'affiche. Plus aucun bouton
// « Pointer mon arrivée / mon départ », ni de saisie manuelle par le salarié : on ne pointe
// qu'en scannant l'affiche du restaurant (docs/superpowers/specs/2026-09-23-pointage-qr-design.md,
// §7). Un oubli de pointage se corrige uniquement par la Direction (Heures supp., Présences).

// Les heures de la journée close viennent du serveur (`heuresPayables`) : aucun calcul ici.
type PointageVue = PointageDuJour["pointage"];

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
  /** Instant ISO d'un départ scanné AVANT la clôture automatique, jamais clos (null sinon). */
  departScanne: string | null;
}) {
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

  const heuresJournee = termine && pointage ? (pointage.heures ?? 0) : 0;

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
              {termine ? "Journée pointée" : pauseAttendue ? "Départ enregistré" : enCours ? "Temps écoulé aujourd'hui" : "Aujourd'hui"}
            </span>
            <span className="mt-1 text-4xl font-bold tabular-nums">
              {/* Même écriture partout (« 7h 30m »), comme « Mon planning » : « 7,5 h » se lisait mal. */}
              {termine ? dureeH(Math.round(heuresJournee * 60) * 60_000) : enCours ? dureeH(ecoule) : "0h 00m"}
            </span>
            {enCours && pointage && (
              <span className="mt-1 text-xs text-muted-foreground">
                Arrivée pointée à {hhmm(pointage.heureDebut)}
                {departScanne && ` · départ enregistré à ${hhmm(departScanne)}`}
              </span>
            )}
            {pauseAttendue && (
              <span className="mt-2 px-4 text-center text-xs text-muted-foreground">
                Scannez de nouveau l&apos;affiche pour clore la journée.
              </span>
            )}
            {termine && pointage && (
              <span className="mt-1 text-xs text-muted-foreground">
                {hhmm(pointage.heureDebut)} → {hhmm(pointage.heureFin!)} · {libellePause(pointage.pause)}
              </span>
            )}
          </div>

          {termine && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✓ Journée enregistrée dans vos présences et vos heures.
            </div>
          )}
        </div>
      </div>

      <p className="px-1 text-center text-xs text-muted-foreground">
        Oubli de pointage ? Prévenez la Direction, qui corrigera vos heures.
      </p>

      <p className="px-1 text-center text-xs text-muted-foreground">
        Votre pointage alimente automatiquement vos présences et vos heures — comme la pointeuse.
      </p>
    </div>
  );
}
