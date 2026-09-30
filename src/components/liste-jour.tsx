import type { ReactNode } from "react";
import { libelleJourLong } from "@/lib/jour-mobile";

// Pièces communes des listes « un jour à la fois » du téléphone (Commande, Rapport journalier,
// Consommation, Comparaison, Stock restaurant) : même titre de jour, même rubrique, même ligne.
// Présentation seule ; les cases de saisie restent la case partagée `CelluleNombre`.

/** Case de saisie du téléphone : 44 px de haut au moins, 16 px de texte (Safari ne zoome pas au focus). */
export const CASE_JOUR = "h-11 w-24 rounded-md border border-input bg-background px-2 text-center text-base outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

/** Titre de la liste : le jour choisi, et à droite un résumé (total du jour, nombre d'articles…). */
export function TitreJour({ iso, resume, extra }: { iso: string; resume?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1">
      <h2 className="text-base font-semibold first-letter:uppercase">{libelleJourLong(iso)}{extra}</h2>
      {resume && <p className="text-sm text-muted-foreground">{resume}</p>}
    </div>
  );
}

/** Rubrique (catégorie, espace) : bandeau sur toute la largeur. */
export function RubriqueJour({ children, ton = "amber" }: { children: ReactNode; ton?: "amber" | "primary" | "sky" | "rouge" | "vert" | "gris" | "indigo" }) {
  const couleurs = {
    amber: "bg-amber-100 text-amber-900", primary: "bg-primary/10 text-foreground", sky: "bg-sky-100 text-sky-900",
    rouge: "bg-red-100 text-red-900", vert: "bg-emerald-100 text-emerald-900", gris: "bg-muted text-foreground", indigo: "bg-indigo-100 text-indigo-900",
  } as const;
  return <div className={`mt-2 rounded-md px-3 py-1.5 text-sm font-semibold ${couleurs[ton]}`}>{children}</div>;
}

/** Ligne d'un article : le nom à gauche (il passe à la ligne, jamais coupé), la valeur ou la case à droite. */
export function LigneJour({ nom, sous, droite, gauche, className = "" }: { nom: ReactNode; sous?: ReactNode; droite?: ReactNode; gauche?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-14 items-center gap-3 border-b px-1 py-1.5 ${className}`}>
      {gauche}
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm font-medium">{nom}</div>
        {sous}
      </div>
      {droite && <div className="flex shrink-0 items-center gap-1.5">{droite}</div>}
    </div>
  );
}
