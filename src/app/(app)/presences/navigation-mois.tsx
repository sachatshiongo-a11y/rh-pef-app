"use client";

// Navigation de mois de l'écran Présences (← Préc. / Suiv. →, « Revenir au mois en cours ») — la même
// forme que le Planning (mêmes classes, même place, à droite du titre). Les liens CONSERVENT la vue en
// cours (Semaine / Mois / Employé, semaine choisie, employé consulté) : ils lisent l'état partagé de la
// page, qui change sans recharger (vue-presences.tsx), et non l'adresse du premier chargement.

import Link from "next/link";
import { useVuePresences } from "./vue-presences";
import { hrefPresences, type Periode } from "@/lib/presences-mois";
import type { SemaineAffichee } from "./semaines";

const LIEN = "rounded-md border px-3 py-1.5 hover:bg-accent";
const INACTIF = "rounded-md border px-3 py-1.5 pointer-events-none opacity-40";

export function NavigationMoisPresences({ courant, prec, suiv, passe, semaines, semaineInitiale, semInitiale }: {
  courant: Periode;
  prec: Periode | null;
  suiv: Periode | null;
  /** Le mois affiché est antérieur au mois courant : le lien de retour apparaît. */
  passe: boolean;
  semaines: SemaineAffichee[];
  /** Rang de la semaine ouverte au chargement, et la valeur `sem` reçue dans l'adresse (rendue telle quelle). */
  semaineInitiale: number;
  semInitiale: string | null;
}) {
  const { vue, semaine, employeId } = useVuePresences();
  const etat = { vue, sem: semaine === semaineInitiale ? semInitiale : semaines[semaine]?.lundi ?? null, emp: employeId };
  if (!prec && !suiv && !passe) return null;
  return (
    <nav aria-label="Changer de mois" className="flex flex-wrap items-center gap-2 text-sm">
      {prec ? (
        <Link href={hrefPresences(prec, courant, etat)} className={LIEN}>← Préc.</Link>
      ) : (
        <span aria-disabled="true" className={INACTIF}>← Préc.</span>
      )}
      {passe && <Link href={hrefPresences(courant, courant, etat)} className={LIEN}>Revenir au mois en cours</Link>}
      {suiv ? (
        <Link href={hrefPresences(suiv, courant, etat)} className={LIEN}>Suiv. →</Link>
      ) : (
        <span aria-disabled="true" className={INACTIF}>Suiv. →</span>
      )}
    </nav>
  );
}
