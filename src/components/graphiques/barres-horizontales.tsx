import type { ReactNode } from "react";

// Barres horizontales en SVG maison (même famille que `graphique-cartesien.tsx`, aucune
// bibliothèque de graphes). Composant SERVEUR : aucun état, aucun effet. Les textes (montant, part)
// arrivent déjà formatés par l'appelant.

export type BarreHorizontale = {
  cle: string;
  libelle: string;
  valeur: number;
  texteValeur: string;
  texteSecondaire?: string;
  /** Valeur CSS (`"var(--chart-vert)"`), jamais une classe Tailwind — comme les autres graphiques. */
  couleur: string;
};

/** Longueur d'une barre en % de la plus grande ; 0 pour une valeur nulle ou négative, ou sans maximum. */
export function largeurRelative(valeur: number, max: number): number {
  if (!(max > 0) || !(valeur > 0)) return 0;
  return Math.min(valeur / max, 1) * 100;
}

/** Une ligne : libellé et montant sur une ligne (le libellé se tronque, jamais le montant), barre dessous. */
export function LigneBarre({
  libelle, texteValeur, texteSecondaire, largeur, couleur, prefixe,
}: {
  libelle: string;
  texteValeur: string;
  texteSecondaire?: string;
  largeur: number;
  couleur: string;
  prefixe?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-baseline gap-1">
          {prefixe}
          <span className="truncate">{libelle}</span>
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="font-medium">{texteValeur}</span>
          {texteSecondaire && <span className="ml-2 text-[11px] text-muted-foreground">{texteSecondaire}</span>}
        </span>
      </div>
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-1 block h-2 w-full" role="img" aria-label={`${libelle} : ${texteValeur}`}>
        <rect x="0" y="0" width="100" height="6" rx="3" style={{ fill: "var(--muted)" }} />
        {largeur > 0 && <rect x="0" y="0" width={largeur} height="6" rx="3" style={{ fill: couleur }} />}
      </svg>
    </div>
  );
}

export function BarresHorizontales({ barres, titre }: { barres: BarreHorizontale[]; titre: string }) {
  const max = Math.max(0, ...barres.map((b) => b.valeur));
  return (
    <ul className="space-y-2" aria-label={titre}>
      {barres.map((b) => (
        <li key={b.cle}>
          <LigneBarre libelle={b.libelle} texteValeur={b.texteValeur} texteSecondaire={b.texteSecondaire} largeur={largeurRelative(b.valeur, max)} couleur={b.couleur} />
        </li>
      ))}
    </ul>
  );
}
