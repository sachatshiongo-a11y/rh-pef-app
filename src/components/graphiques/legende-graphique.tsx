export type EntreeLegende = { label: string; couleur: string; forme: "ligne" | "ligne-pointillee" | "barre" };

/**
 * Légende — obligatoire dès 2 séries (règle dataviz) : identité d'une série = sa couleur ET son
 * libellé ET sa forme (trait plein / pointillé / barre), jamais la couleur seule.
 */
export function LegendeGraphique({ entrees }: { entrees: EntreeLegende[] }) {
  if (entrees.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" role="list">
      {entrees.map((e) => (
        <li key={e.label} className="flex items-center gap-1.5">
          <SwatchLegende couleur={e.couleur} forme={e.forme} />
          <span>{e.label}</span>
        </li>
      ))}
    </ul>
  );
}

function SwatchLegende({ couleur, forme }: { couleur: string; forme: EntreeLegende["forme"] }) {
  if (forme === "barre") {
    return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: couleur }} aria-hidden />;
  }
  return (
    <svg width="16" height="8" aria-hidden className="shrink-0">
      <line
        x1={0} y1={4} x2={16} y2={4}
        style={{ stroke: couleur }}
        strokeWidth={2}
        strokeDasharray={forme === "ligne-pointillee" ? "4 3" : undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}
