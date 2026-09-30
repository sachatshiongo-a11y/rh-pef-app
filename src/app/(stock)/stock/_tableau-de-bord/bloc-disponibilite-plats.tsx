import { Suspense } from "react";
import Link from "next/link";
import type { Role } from "@prisma/client";
import { estStock } from "@/lib/espaces";
import { chargerDisponibilitePlats, type DisponibilitePlats } from "@/app/(stock)/stock/fiches/_data/disponibilite-plats";
import { ListeDisponibilitePlats, TITRE_DISPONIBILITE_PLATS } from "@/components/stock/disponibilite-plats";

/**
 * Droit de voir le bloc : celui de l'écran Fiches techniques de l'espace Stock (même garde, `estStock`
 * — le menu de l'espace n'a pas de restriction de rôle sur « Fiches techniques »). Sans droit, rien
 * n'est lu ni affiché.
 */
export function voitDisponibilitePlats(user: { role: Role; accesStock?: boolean }): boolean {
  return estStock(user);
}

/**
 * Bloc « Plats (disponibilité selon le stock) » du tableau de bord Stock (demande Direction
 * 2026-09-30) — le même bloc, sur le même calcul (`chargerDisponibilitePlats`), que l'accueil de
 * l'Exploitation. La disponibilité est celle d'AUJOURD'HUI, jamais celle du mois choisi : quand le
 * sélecteur est sur un mois passé, le titre le dit (`periode`, même repère que les autres blocs).
 *
 * Chargé sous `Suspense` (comme les cartes d'entrées) : la page s'affiche sans attendre les stocks
 * de toutes les fiches. La cellule prend la largeur d'une colonne du tableau de bord, une seule
 * colonne sur téléphone.
 */
export function BlocDisponibilitePlats({ voit, periode }: { voit: boolean; periode?: string }) {
  if (!voit) return null;
  return (
    <Suspense fallback={<p className="text-xs text-muted-foreground" data-bloc-disponibilite-plats>Plats : chargement…</p>}>
      <BlocDisponibilitePlatsCharge periode={periode} />
    </Suspense>
  );
}

/** Bloc chargé (exporté pour les tests : un rendu statique ne résout pas `Suspense`, il ne montre que son repli). */
export async function BlocDisponibilitePlatsCharge({ periode }: { periode?: string }) {
  return <BlocDisponibilitePlatsVue donnees={await chargerDisponibilitePlats()} periode={periode} />;
}

/** Présentation (sans lecture). */
export function BlocDisponibilitePlatsVue({ donnees, periode }: { donnees: DisponibilitePlats; periode?: string }) {
  return (
    <div className="min-w-0 rounded-lg border p-5" data-bloc-disponibilite-plats>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold">
          {TITRE_DISPONIBILITE_PLATS}
          {periode && <span className="text-xs font-normal text-muted-foreground" data-periode> · {periode}</span>}
        </h2>
        <Link href="/stock/fiches" className="shrink-0 text-xs text-primary underline">Tout voir</Link>
      </div>
      <ListeDisponibilitePlats donnees={donnees} avecLiens />
    </div>
  );
}
