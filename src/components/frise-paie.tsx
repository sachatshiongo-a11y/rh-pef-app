/** Couleur graduée : plus on approche du jour de paie, plus c'est orange ; rouge une fois dépassé. */
function couleurProximite(jours: number | null): string {
  if (jours === null) return "bg-slate-400";
  if (jours < 0) return "bg-red-600";
  if (jours === 0) return "bg-orange-600";
  if (jours <= 3) return "bg-orange-500";
  if (jours <= 7) return "bg-amber-500";
  if (jours <= 12) return "bg-amber-400";
  return "bg-emerald-500";
}

/** Étape de la paie du mois : 0 = non calculée, 1 = calculée, 2 = validation en cours, 3 = payée. */
export function calculerEtapePaie(a: {
  hasRun: boolean;
  total: number;
  nbPaye: number;
  nbValide: number;
  nbPasValide: number;
}): 0 | 1 | 2 | 3 {
  if (!a.hasRun || a.total === 0) return 0;
  if (a.nbPaye === a.total) return 3;
  if (a.nbValide + a.nbPaye > 0 || a.nbPasValide < a.total) return 2;
  return 1;
}

const ETAPES = [
  { label: "Calcul", sous: "bulletins générés" },
  { label: "Validation", sous: "bulletins signés" },
  { label: "Paiement", sous: null as string | null },
];

/**
 * Frise chronologique de la paie du mois (jour de paie le 30). Purement présentationnelle :
 * chaque page calcule `etape` via `calculerEtapePaie`. Aucune icône décorative.
 */
export function FrisePaie({
  mois,
  annee,
  etape,
  jourPaie = 30,
  compact = false,
}: {
  mois: number;
  annee: number;
  etape: 0 | 1 | 2 | 3;
  jourPaie?: number;
  compact?: boolean;
}) {
  const auj = new Date();
  const estMoisCourant = auj.getMonth() + 1 === mois && auj.getFullYear() === annee;
  const joursAvantPaie = estMoisCourant ? jourPaie - auj.getDate() : null;
  const couleur = couleurProximite(joursAvantPaie);
  // Avancement temporel vers le jour de paie (0 → 100 %) : la frise « avance » avec les jours.
  const progression = estMoisCourant ? Math.min(100, Math.max(0, (auj.getDate() / jourPaie) * 100)) : etape >= 3 ? 100 : 0;
  const datePaie = new Date(annee, mois - 1, jourPaie).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  });
  const etapes = ETAPES.map((e, i) => (i === 2 ? { ...e, sous: `le ${datePaie}` } : e));

  const badge =
    joursAvantPaie === null
      ? null
      : joursAvantPaie < 0
        ? `clôture en retard de ${-joursAvantPaie} j`
        : joursAvantPaie === 0
          ? "jour de paie aujourd'hui"
          : `paiement dans ${joursAvantPaie} j`;

  return (
    <div className={`rounded-xl border bg-card ${compact ? "p-4" : "p-5"} shadow-sm`}>
      <div className="mb-4 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">
          Frise de la paie —{" "}
          <span className="capitalize text-muted-foreground">
            {new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
          </span>
        </p>
        {badge && (
          <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${couleur}`}>
            {badge}
          </span>
        )}
      </div>

      <div className="flex items-start">
        {etapes.map((e, i) => {
          const atteinte = etape > i;
          return (
            <div key={e.label} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* Segment gauche */}
                <div
                  className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : atteinte ? couleur : "bg-muted"}`}
                />
                {/* Nœud */}
                <div
                  className={`z-10 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-card ${
                    atteinte ? couleur : "border-2 border-muted bg-background"
                  }`}
                />
                {/* Segment droit */}
                <div
                  className={`h-0.5 flex-1 ${
                    i === etapes.length - 1 ? "opacity-0" : etape > i + 1 ? couleur : "bg-muted"
                  }`}
                />
              </div>
              <p
                className={`mt-2 text-center text-xs ${
                  atteinte ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {e.label}
              </p>
              <p className="text-center text-[11px] text-muted-foreground">{e.sous}</p>
            </div>
          );
        })}
      </div>

      {/* Avancement dans le mois vers le jour de paie (la frise avance avec les jours). */}
      {estMoisCourant && (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full transition-all ${couleur}`} style={{ width: `${progression}%` }} />
          </div>
          <p className="mt-1 text-right text-[11px] text-muted-foreground">Jour {auj.getDate()} / {jourPaie}</p>
        </div>
      )}
    </div>
  );
}
