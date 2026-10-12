"use client";

import { usePathname } from "next/navigation";
import { SOUS_ONGLETS_ACHATS, sousOngletActif } from "@/lib/achats-liste";
import { OngletsDefilants } from "@/components/onglets-defilants";

/**
 * Sous-onglets de l'entrée de menu « Achats & mouvements » (décision Direction 2026-09-28) :
 * Mouvements, Liste d'achat, Légumes frais — trois routes existantes, inchangées. Segment commun
 * des vues (H2). Aucun encart d'explication (H6) : les trois noms se suffisent.
 */
export function OngletsAchats() {
  const actif = sousOngletActif(usePathname() ?? "");
  return (
    <OngletsDefilants
      libelle="Achats et mouvements"
      onglets={SOUS_ONGLETS_ACHATS.map((o) => ({ href: o.href, label: o.label, actif: actif === o.href }))}
    />
  );
}
