import type { ReactNode } from "react";

/**
 * Bouton à menu des FICHES À REMPLIR (fiche d'achat de légumes, fiches d'inventaire) : même allure
 * que le menu « Exporter ▾ » voisin, sans JavaScript (élément <details>). Le panneau s'ouvre sous
 * le bouton, aligné à droite et borné à la largeur de l'écran sur téléphone.
 */
export function MenuFichePdf({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <details className="relative inline-block">
      <summary className="cursor-pointer list-none rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden">
        {libelle} ▾
      </summary>
      <div className="absolute left-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border bg-card p-3 shadow-xl">
        {children}
      </div>
    </details>
  );
}

/** Lien de téléchargement d'une fiche, dans le style des boutons du menu « Exporter ». */
export const classeLienFiche =
  "block rounded-md border px-2 py-2 text-center text-sm font-medium hover:border-primary hover:bg-accent active:bg-accent";
