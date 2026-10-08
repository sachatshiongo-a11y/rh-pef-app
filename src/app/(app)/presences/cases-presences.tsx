"use client";

// Les trois cases de Présences & heures — présentation seule (la saisie, le menu et les écritures
// restent dans temps-grid.tsx) :
//  - CaseSemaine   : vue Semaine, grande case (code + heures + horaire), la lecture de travail ;
//  - CaseMois      : vue Mois, case étroite d'une seule lettre (l'horaire est dans l'infobulle et le menu) ;
//  - CaseCalendrier: vue Employé, case d'un calendrier du mois.
// Mêmes couleurs de code (COULEUR_CODE_HEX), mêmes repères qu'avant : ambre = au-delà du shift
// prévu, ● = pointage réel, p* = pause par défaut non déduite.

import type { KeyboardEvent, MouseEvent } from "react";

export type PropsCase = {
  emp: string;
  day: number;
  code: string;
  heures: number | null;
  /** Heures au-delà du shift prévu (ambre). */
  supp: boolean;
  horaire: string | null;
  reel: boolean;
  pauseParDefaut: boolean;
  couleur?: { bg: string; text: string };
  disabled: boolean;
  title?: string;
  libelle: string;
  onClick: (ev: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (ev: KeyboardEvent<HTMLButtonElement>) => void;
};

export const fmtH = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

const BASE = "rounded-md border border-transparent leading-none hover:border-input focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";
const PASTILLE_SUPP = "rounded bg-amber-100 px-1 py-0.5 font-semibold text-amber-800";

function Horaire({ p, classe }: { p: PropsCase; classe: string }) {
  if (!p.horaire) return <span className={`${classe} opacity-40`}>—</span>;
  return (
    <span className={`${classe} max-w-full truncate tabular-nums ${p.supp ? "font-semibold text-[#92400e]" : p.reel ? "font-semibold" : "opacity-70"}`}>
      {p.reel ? "● " : ""}{p.horaire}{p.reel && p.pauseParDefaut ? " p*" : ""}
    </span>
  );
}

export function CaseSemaine(p: PropsCase) {
  return (
    <button
      type="button" data-emp={p.emp} data-day={p.day} disabled={p.disabled}
      onClick={p.onClick} onKeyDown={p.onKeyDown} title={p.title} aria-label={p.libelle}
      className={`${BASE} flex h-14 w-full min-w-0 flex-col items-center justify-center gap-1 px-0.5`}
      style={p.couleur ? { backgroundColor: p.couleur.bg, color: p.couleur.text } : undefined}
    >
      <span className="flex items-center gap-1 text-sm font-bold">
        {p.code || "·"}
        {p.heures !== null && p.heures > 0 && (
          <span className={`text-xs tabular-nums ${p.supp ? PASTILLE_SUPP : "font-normal opacity-80"}`}>{fmtH(p.heures)} h</span>
        )}
      </span>
      <Horaire p={p} classe="text-[10px] xl:text-[11px]" />
    </button>
  );
}

export function CaseMois(p: PropsCase) {
  const prevu = !p.code && !!p.horaire; // un shift prévu mais rien de saisi : point discret
  return (
    <button
      type="button" data-emp={p.emp} data-day={p.day} disabled={p.disabled}
      onClick={p.onClick} onKeyDown={p.onKeyDown} title={p.title} aria-label={p.libelle}
      className={`${BASE} relative flex h-8 w-full min-w-0 items-center justify-center text-[11px] font-bold`}
      style={p.couleur ? { backgroundColor: p.couleur.bg, color: p.couleur.text } : undefined}
    >
      {p.code || (prevu ? <span aria-hidden className="text-muted-foreground/60">·</span> : "")}
      {p.supp && <span aria-hidden className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />}
    </button>
  );
}

export function CaseCalendrier(p: PropsCase & { jour: number; selectionne: boolean; surCoche?: () => void; ferie: boolean; majore: boolean; aujourdhui: boolean }) {
  return (
    <div className={`relative rounded-lg border ${p.majore ? "bg-orange-50" : "bg-card"} ${p.selectionne ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center justify-between px-1.5 pt-1">
        <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium ${p.aujourdhui ? "bg-primary font-semibold text-primary-foreground" : ""}`}>{p.jour}</span>
        {p.ferie && <span className="text-[9px] uppercase text-orange-700">Férié</span>}
        {p.surCoche && (
          <input
            type="checkbox" checked={p.selectionne} onChange={p.surCoche}
            aria-label={`Cocher le jour ${p.jour}`} className="h-4 w-4"
          />
        )}
      </div>
      <button
        type="button" data-emp={p.emp} data-day={p.day} disabled={p.disabled}
        onClick={p.onClick} onKeyDown={p.onKeyDown} title={p.title} aria-label={p.libelle}
        className={`${BASE} m-1 flex h-14 w-[calc(100%-0.5rem)] min-w-0 flex-col items-center justify-center gap-1`}
        style={p.couleur ? { backgroundColor: p.couleur.bg, color: p.couleur.text } : undefined}
      >
        <span className="flex items-center gap-1 text-sm font-bold">
          {p.code || "·"}
          {p.heures !== null && p.heures > 0 && (
            <span className={`text-xs tabular-nums ${p.supp ? PASTILLE_SUPP : "font-normal opacity-80"}`}>{fmtH(p.heures)} h</span>
          )}
        </span>
        <Horaire p={p} classe="text-[11px]" />
      </button>
    </div>
  );
}
