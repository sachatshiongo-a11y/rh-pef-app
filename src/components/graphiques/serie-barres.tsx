import type { SerieBarresConfig } from "./types";

/**
 * Chemin d'une barre aux bouts arrondis (4px) ANCRÉS à la ligne de base — seul le bout éloigné de
 * la base (le sommet d'une barre positive, le bas d'une barre négative) est arrondi ; le bord posé
 * sur la ligne de base reste droit (rule dataviz : « ancrés à la ligne de base »).
 */
function cheminBarreArrondie(x: number, largeur: number, yBase: number, yValeur: number, rayon = 4): string {
  const versLeHaut = yValeur < yBase; // valeur positive → sommet au-dessus de la base (y SVG plus petit)
  const r = Math.min(rayon, largeur / 2, Math.abs(yBase - yValeur));
  if (r <= 0.01) {
    // Barre trop plate pour arrondir proprement (valeur ~0) — rectangle simple, invisible ou quasi.
    return `M ${x} ${yBase} L ${x} ${yValeur} L ${x + largeur} ${yValeur} L ${x + largeur} ${yBase} Z`;
  }
  if (versLeHaut) {
    return `M ${x} ${yBase} L ${x} ${yValeur + r} Q ${x} ${yValeur} ${x + r} ${yValeur} L ${x + largeur - r} ${yValeur} Q ${x + largeur} ${yValeur} ${x + largeur} ${yValeur + r} L ${x + largeur} ${yBase} Z`;
  }
  return `M ${x} ${yBase} L ${x} ${yValeur - r} Q ${x} ${yValeur} ${x + r} ${yValeur} L ${x + largeur - r} ${yValeur} Q ${x + largeur} ${yValeur} ${x + largeur} ${yValeur - r} L ${x + largeur} ${yBase} Z`;
}

/** Une série BARRES du graphique cartésien — couleur calculée par barre (ex. résultat : vert si
 *  ≥ 0, rouge sinon), écart de 2px entre barres géré par `largeurBarre` (calculé par l'appelant à
 *  partir de la largeur de bande mensuelle, cf. `GraphiqueCartesien`). */
export function SerieBarresSvg({
  serie, xCentre, yPix, yZero, largeurBarre,
}: {
  serie: SerieBarresConfig;
  xCentre: (i: number) => number;
  yPix: (v: number) => number;
  yZero: number;
  largeurBarre: number;
}) {
  return (
    <g>
      {serie.valeurs.map((v, i) => {
        if (v === null) return null;
        const x = xCentre(i) - largeurBarre / 2;
        const y = yPix(v);
        return <path key={i} d={cheminBarreArrondie(x, largeurBarre, yZero, y, 4)} style={{ fill: serie.couleur(v, i) }} />;
      })}
    </g>
  );
}
