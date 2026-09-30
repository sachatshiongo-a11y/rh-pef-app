"use client";

import { libelleJourLong, rangDansSemaine } from "@/lib/jour-mobile";
import { useJourMobile, useVueSemaine } from "./jour-mobile";

// Téléphone : « un jour à la fois ». Sept pastilles L M M J V S D (la date dessous), à côté du
// sélecteur de semaine ; le jour choisi commande la liste du jour de chaque onglet (même état
// partagé, `jour-mobile.tsx`). En « Vue semaine », la rangée cède la place à une ligne qui
// ramène au jour. Invisible dès `lg` : l'ordinateur garde ses tableaux.

const INITIALES = ["L", "M", "M", "J", "V", "S", "D"];

/** Rang du jour affiché, ramené dans la liste (le Rapport journalier peut n'avoir que 6 jours). */
export function useJourAffiche(isos: string[]): [number, (n: number) => void] {
  const [idx, setIdx] = useJourMobile(0);
  return [Math.min(Math.max(idx, 0), Math.max(isos.length - 1, 0)), setIdx];
}

export function SelecteurJour({ jours, aujourdhui }: { jours: { iso: string }[]; aujourdhui: string }) {
  const isos = jours.map((j) => j.iso);
  const [actif, choisir] = useJourAffiche(isos);
  const [semaine, setSemaine] = useVueSemaine();

  if (semaine) {
    return (
      <div data-selecteur-jour="" className="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 text-sm lg:hidden">
        <span className="min-w-0">Vue semaine : faites défiler de côté.</span>
        <button type="button" onClick={() => setSemaine(false)} className="min-h-11 shrink-0 font-medium text-primary underline underline-offset-2">Revenir au jour</button>
      </div>
    );
  }
  return (
    <div
      data-selecteur-jour="" role="group" aria-label="Jour affiché"
      className="grid gap-1 lg:hidden" style={{ gridTemplateColumns: `repeat(${isos.length}, minmax(0, 1fr))` }}
    >
      {isos.map((iso, i) => {
        const choisi = i === actif;
        const estAujourdhui = iso === aujourdhui;
        return (
          <button
            key={iso} type="button" onClick={() => choisir(i)}
            aria-pressed={choisi} aria-current={estAujourdhui ? "date" : undefined}
            aria-label={`${libelleJourLong(iso)}${estAujourdhui ? " (aujourd'hui)" : ""}`}
            className={`flex min-h-12 flex-col items-center justify-center rounded-lg border leading-tight ${choisi ? "border-primary bg-primary text-primary-foreground" : estAujourdhui ? "border-primary hover:bg-accent" : "hover:bg-accent"}`}
          >
            <span className="text-sm font-semibold">{INITIALES[rangDansSemaine(iso)]}</span>
            <span className="text-xs tabular-nums">{Number(iso.slice(8, 10))}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Bouton du menu « Plus » : bascule entre la liste du jour et le tableau de la semaine (téléphone). */
export function BasculeVueSemaine() {
  const [semaine, setSemaine] = useVueSemaine();
  return (
    <button
      type="button" data-ferme-plus="" aria-pressed={semaine} onClick={() => setSemaine(!semaine)}
      className="min-h-11 rounded-md border bg-background px-3 text-left font-medium hover:bg-accent"
    >
      {semaine ? "Revenir à la vue du jour" : "Vue semaine (tableau qui défile de côté)"}
    </button>
  );
}
