import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { lundiDe, MOIS_FR } from "@/lib/dates-fr";

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function addJours(base: Date, n: number) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d; }

export default async function EspacePlanning() {
  const s = await chargerSalarie();
  const lundiCourant = lundiDe(new Date(Date.now() + 3_600_000));
  // 4 semaines à venir (courante incluse) — on n'affiche QUE celles publiées par la Direction.
  const semaines = [0, 1, 2, 3].map((i) => addJours(lundiCourant, i * 7));
  const fin = addJours(semaines[semaines.length - 1], 6);

  const [creneaux, publiees] = await Promise.all([
    prisma.planningCreneau.findMany({
      where: { employeeId: s.employeeId, date: { gte: lundiCourant, lte: fin } },
      select: { date: true, shift: { select: { nom: true, heureDebut: true, heureFin: true } } },
    }),
    prisma.semainePubliee.findMany({ where: { lundi: { gte: lundiCourant, lte: fin } }, select: { lundi: true } }),
  ]);
  const publieeSet = new Set(publiees.map((p) => iso(new Date(p.lundi))));
  const parJour = new Map(creneaux.map((c) => [iso(new Date(c.date)), c.shift]));
  const isoAuj = iso(new Date());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mon planning</h1>
        <p className="text-sm text-muted-foreground">Vos services des semaines publiées par la Direction.</p>
      </div>

      {semaines.map((lundi) => {
        const cleSem = iso(lundi);
        const publiee = publieeSet.has(cleSem);
        const dim = addJours(lundi, 6);
        const titre = `Semaine du ${lundi.getUTCDate()} ${MOIS_FR[lundi.getUTCMonth()]} au ${dim.getUTCDate()} ${MOIS_FR[dim.getUTCMonth()]}`;
        return (
          <div key={cleSem} className="overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-4 py-2 text-sm font-semibold">
              <span>{titre}</span>
              {!publiee && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">Non publié</span>}
            </div>
            {!publiee ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Cette semaine n&apos;est pas encore publiée.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-7">
                {Array.from({ length: 7 }, (_, i) => {
                  const jour = addJours(lundi, i);
                  const k = iso(jour);
                  const shift = parJour.get(k);
                  const auj = k === isoAuj;
                  return (
                    <div key={k} className={`rounded-lg border p-2 text-center ${auj ? "border-primary bg-primary/5" : ""}`}>
                      <div className="text-[11px] font-medium text-muted-foreground">{JOURS_COURTS[i]} {jour.getUTCDate()}</div>
                      {shift ? (
                        shift.heureDebut && shift.heureFin ? (
                          <div className="mt-1">
                            <div className="text-xs font-semibold">{shift.nom}</div>
                            <div className="text-[11px] tabular-nums text-muted-foreground">{shift.heureDebut}–{shift.heureFin}</div>
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-muted-foreground">{shift.nom}</div>
                        )
                      ) : (
                        <div className="mt-2 text-xs text-muted-foreground">Repos</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Les horaires peuvent être ajustés par la Direction. En cas de doute, rapprochez-vous d&apos;elle.</p>
    </div>
  );
}
