"use client";

import { useState } from "react";
import { Icone } from "@/components/icones";

/**
 * Bascule « Graphique / Tableau » par panneau — même bibliothèque de composants que le sélecteur
 * de thème (`ThemeToggle`) : groupe de boutons `aria-pressed`, mêmes classes. La vue Tableau donne
 * accès aux MÊMES chiffres que le graphique (accessibilité, cf. règle dataviz).
 */
export function BasculeGraphiqueTableau({
  graphique, tableau, titre,
}: {
  graphique: React.ReactNode;
  tableau: React.ReactNode;
  titre?: string;
}) {
  const [vue, setVue] = useState<"graphique" | "tableau">("graphique");

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs" role="group" aria-label={`Affichage${titre ? ` — ${titre}` : ""}`}>
          <button
            type="button"
            onClick={() => setVue("graphique")}
            aria-pressed={vue === "graphique"}
            className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${vue === "graphique" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icone nom="tendance" taille={13} /> Graphique
          </button>
          <button
            type="button"
            onClick={() => setVue("tableau")}
            aria-pressed={vue === "tableau"}
            className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${vue === "tableau" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icone nom="document" taille={13} /> Tableau
          </button>
        </div>
      </div>
      {vue === "graphique" ? graphique : tableau}
    </div>
  );
}
