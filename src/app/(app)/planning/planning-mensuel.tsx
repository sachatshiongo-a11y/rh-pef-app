import Link from "next/link";
import { paletteDe } from "./creneaux";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export type CreneauJour = { nom: string; shift: string; couleur: string };

/** Vue mensuelle (lecture seule) du planning : chaque jour liste les employés planifiés. */
export function PlanningMensuel({
  mois,
  annee,
  creneauxParJour,
  feriesIso,
  isoAujourdhui,
}: {
  mois: number;
  annee: number;
  creneauxParJour: Record<string, CreneauJour[]>;
  feriesIso: Set<string>;
  isoAujourdhui: string;
}) {
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const premier = debutMois.getUTCDay();
  const offset = (premier + 6) % 7;
  const nbJours = finMois.getUTCDate();
  const nbCases = Math.ceil((offset + nbJours) / 7) * 7;
  const cases = Array.from({ length: nbCases }, (_, i) => {
    const d = new Date(debutMois);
    d.setUTCDate(1 - offset + i);
    return d;
  });
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-7 bg-muted/50 text-xs font-medium">
        {JOURS.map((j) => (
          <div key={j} className="px-2 py-2 text-center">
            {j}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cases.map((d, i) => {
          const key = iso(d);
          const dansLeMois = d.getUTCMonth() === mois - 1;
          const dimanche = d.getUTCDay() === 0;
          const ferie = feriesIso.has(key);
          const items = creneauxParJour[key] ?? [];
          const estAuj = key === isoAujourdhui;
          return (
            <div
              key={i}
              className={`min-h-24 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0 ${
                !dansLeMois ? "bg-muted/30 text-muted-foreground/50" : dimanche || ferie ? "bg-orange-50" : "bg-background"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <Link
                  href={`/planning?vue=semaine&debut=${key}`}
                  title="Voir cette semaine"
                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs hover:ring-1 hover:ring-primary ${
                    estAuj ? "bg-primary font-semibold text-primary-foreground" : "font-medium"
                  }`}
                >
                  {d.getUTCDate()}
                </Link>
                {ferie && dansLeMois && <span className="text-[9px] uppercase text-orange-600">Férié</span>}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 4).map((c, k) => (
                  <div
                    key={k}
                    className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${paletteDe(c.couleur).classe}`}
                    title={`${c.nom} — ${c.shift}`}
                  >
                    {c.nom}
                  </div>
                ))}
                {items.length > 4 && (
                  <div className="px-1 text-[10px] text-muted-foreground">+{items.length - 4} autre(s)</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
