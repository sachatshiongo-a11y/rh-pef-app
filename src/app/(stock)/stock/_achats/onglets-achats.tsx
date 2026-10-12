"use client";

import { usePathname } from "next/navigation";
import { SOUS_ONGLETS_ACHATS, sousOngletActif } from "@/lib/achats-liste";
import { OngletsDefilants } from "@/components/onglets-defilants";

/**
 * Sous-onglets de l'entrée de menu « Achats & mouvements » (décision Direction 2026-09-28) :
 * Mouvements, Liste d'achat, Légumes frais — trois routes existantes, inchangées. Segment commun
 * des vues (H2) ; un encart court dit ce qui distingue les trois.
 */
export function OngletsAchats() {
  const actif = sousOngletActif(usePathname() ?? "");
  return (
    <div className="space-y-2">
      <OngletsDefilants
        libelle="Achats et mouvements"
        onglets={SOUS_ONGLETS_ACHATS.map((o) => ({ href: o.href, label: o.label, actif: actif === o.href }))}
      />
      <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {SOUS_ONGLETS_ACHATS.map((o, i) => (
          <span key={o.href}>
            {i > 0 && " · "}
            <strong className="font-medium text-foreground">{o.label}</strong> : {o.aide}
          </span>
        ))}
        .
      </p>
    </div>
  );
}
