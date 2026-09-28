"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SOUS_ONGLETS_ACHATS, sousOngletActif } from "@/lib/achats-liste";

/**
 * Sous-onglets de l'entrée de menu « Achats & mouvements » (décision Direction 2026-09-28) :
 * Mouvements, Liste d'achat, Légumes frais — trois routes existantes, inchangées. Pastilles du
 * reste de l'espace Stock ; un encart court dit ce qui distingue les trois.
 */
export function OngletsAchats() {
  const actif = sousOngletActif(usePathname() ?? "");
  return (
    <div className="space-y-2">
      <nav aria-label="Achats et mouvements" className="flex flex-wrap gap-1.5 text-sm">
        {SOUS_ONGLETS_ACHATS.map((o) => (
          <Link
            key={o.href}
            href={o.href}
            aria-current={actif === o.href ? "page" : undefined}
            className={`rounded-full border px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring ${actif === o.href ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}
          >
            {o.label}
          </Link>
        ))}
      </nav>
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
