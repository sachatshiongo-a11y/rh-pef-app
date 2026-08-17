import type { SerieLigneConfig } from "./types";

/**
 * Une série LIGNE du graphique cartésien : trait fin (2px), marqueurs ≥8px de diamètre (r=4,5),
 * segments interrompus sur les mois `null` (jamais d'interpolation qui inventerait une valeur —
 * cf. `construireSerieCaSeuil`, seuil `null` certains mois). Libellé direct optionnel sur le
 * dernier point connu, en ENCRE NEUTRE (jamais la couleur de la série — seule la couleur du
 * trait/marqueur porte l'identité visuelle, redondante avec la légende).
 */
export function SerieLigneSvg({
  serie, xCentre, yPix, formatValeur,
}: {
  serie: SerieLigneConfig;
  xCentre: (i: number) => number;
  yPix: (v: number) => number;
  formatValeur: (n: number) => string;
}) {
  const { valeurs, couleur, pointille, marquerIndices, couleurMarqueur, libelleDirect } = serie;

  // Un sous-tracé par segment CONTIGU de valeurs connues.
  const segments: { x: number; y: number }[][] = [];
  let courant: { x: number; y: number }[] = [];
  valeurs.forEach((v, i) => {
    if (v === null) {
      if (courant.length) segments.push(courant);
      courant = [];
      return;
    }
    courant.push({ x: xCentre(i), y: yPix(v) });
  });
  if (courant.length) segments.push(courant);

  let dernierIndex = -1;
  valeurs.forEach((v, i) => { if (v !== null) dernierIndex = i; });

  return (
    <g>
      {segments.map((seg, idx) => (
        <path
          key={idx}
          d={`M ${seg.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
          fill="none"
          style={{ stroke: couleur }}
          strokeWidth={2}
          strokeDasharray={pointille ? "6 4" : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {valeurs.map((v, i) => {
        if (v === null) return null;
        const marque = marquerIndices?.includes(i);
        return (
          <circle
            key={i}
            cx={xCentre(i)}
            cy={yPix(v)}
            r={4.5}
            style={{ fill: marque ? (couleurMarqueur ?? couleur) : couleur }}
          />
        );
      })}
      {libelleDirect && dernierIndex >= 0 && (
        <text
          x={xCentre(dernierIndex) + 6}
          y={yPix(valeurs[dernierIndex] as number) - 7}
          fontSize={10}
          style={{ fill: "var(--muted-foreground)" }}
        >
          {formatValeur(valeurs[dernierIndex] as number)}
        </text>
      )}
    </g>
  );
}
