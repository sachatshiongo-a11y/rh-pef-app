export type LigneInfobulle = { label: string; couleur: string; texte: string; pointille?: boolean };

/**
 * Infobulle de survol — même contenu qu'une série soit une LIGNE ou des BARRES (Task Graphiques :
 * « infobulle sur les lignes, infobulle par barre »), déclenchée par une cible de survol commune
 * PLUS GRANDE que chaque marque (une bande par mois, cf. `GraphiqueCartesien`). Overlay HTML
 * positionné en absolu au-dessus du SVG (pas un <foreignObject> — plus simple à dimensionner et à
 * faire retourner à la ligne).
 */
export function InfobulleGraphique({ titre, lignes, xPourcent }: { titre: string; lignes: LigneInfobulle[]; xPourcent: number }) {
  if (lignes.length === 0) return null;
  // Bornée pour ne jamais déborder du conteneur sur les mois de bord (janvier/décembre).
  const clamped = Math.min(88, Math.max(12, xPourcent));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-36 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ left: `${clamped}%` }}
      role="status"
    >
      <p className="mb-1 font-medium">{titre}</p>
      <ul className="space-y-0.5">
        {lignes.map((l) => (
          <li key={l.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={
                  l.pointille
                    ? { border: "1px dashed", borderColor: l.couleur, backgroundColor: "transparent" }
                    : { backgroundColor: l.couleur }
                }
                aria-hidden
              />
              <span className="truncate">{l.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">{l.texte}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
