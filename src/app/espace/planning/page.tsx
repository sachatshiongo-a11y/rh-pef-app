import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { lundiDe, MOIS_FR } from "@/lib/dates-fr";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import Link from "next/link";
import { Icone } from "@/components/icones";

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function addJours(base: Date, n: number) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d; }
function fmtH(h: number) {
  const heures = Math.floor(h);
  const min = Math.round((h - heures) * 60);
  return `${heures}h ${String(min).padStart(2, "0")}m`;
}

export default async function EspacePlanning() {
  const s = await chargerSalarie();
  // « Aujourd'hui » à l'heure de Kinshasa (DATE à minuit UTC) : semaine et mois en cours en découlent.
  const k = jourCivilKinshasa(new Date());
  const lundiCourant = lundiDe(k);
  // 4 semaines à venir (courante incluse) — on n'affiche QUE celles publiées par la Direction.
  const semaines = [0, 1, 2, 3].map((i) => addJours(lundiCourant, i * 7));
  const fin = addJours(semaines[semaines.length - 1], 6);

  // Heures RÉELLEMENT effectuées : mois civil en cours (heure de Kinshasa).
  const debutMois = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1));
  const finMois = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0));

  const [creneaux, publiees, heuresMois] = await Promise.all([
    prisma.planningCreneau.findMany({
      where: { employeeId: s.employeeId, date: { gte: lundiCourant, lte: fin } },
      select: { date: true, shift: { select: { nom: true, heureDebut: true, heureFin: true } } },
    }),
    prisma.semainePubliee.findMany({ where: { lundi: { gte: lundiCourant, lte: fin } }, select: { lundi: true } }),
    prisma.overtimeEntry.findMany({
      where: { employeeId: s.employeeId, date: { gte: debutMois, lte: finMois } },
      select: { date: true, heuresTravaillees: true },
      orderBy: { date: "asc" },
    }),
  ]);
  const publieeSet = new Set(publiees.map((p) => iso(new Date(p.lundi))));
  const parJour = new Map(creneaux.map((c) => [iso(new Date(c.date)), c.shift]));
  const isoAuj = iso(k); // aujourd'hui à Kinshasa

  // Total du mois + total de la semaine en cours (heures effectuées).
  const totalMois = heuresMois.reduce((a, h) => a + Number(h.heuresTravaillees), 0);
  const dimCourant = addJours(lundiCourant, 6);
  const totalSemaine = heuresMois
    .filter((h) => { const d = new Date(h.date); return d >= lundiCourant && d <= dimCourant; })
    .reduce((a, h) => a + Number(h.heuresTravaillees), 0);
  const moisLabel = `${MOIS_FR[k.getUTCMonth()]} ${k.getUTCFullYear()}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mon planning</h1>
        <p className="text-sm text-muted-foreground">Vos shifts des semaines publiées par la Direction, et les heures que vous avez faites.</p>
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
              // Téléphone : une ligne par jour (se lit de haut en bas) ; écran large : une case par jour.
              <ul className="divide-y sm:grid sm:grid-cols-4 sm:gap-2 sm:divide-y-0 sm:p-3 lg:grid-cols-7">
                {Array.from({ length: 7 }, (_, i) => {
                  const jour = addJours(lundi, i);
                  const k = iso(jour);
                  const shift = parJour.get(k);
                  const auj = k === isoAuj;
                  return (
                    <li
                      key={k}
                      aria-current={auj ? "date" : undefined}
                      className={`flex min-h-12 items-center gap-3 px-4 py-2 sm:block sm:min-h-0 sm:rounded-lg sm:border sm:p-2 sm:text-center ${auj ? "bg-primary/5 sm:border-primary" : ""}`}
                    >
                      <div className={`w-20 shrink-0 text-sm sm:w-auto sm:text-[11px] ${auj ? "font-semibold text-primary" : "font-medium text-muted-foreground"}`}>
                        {JOURS_COURTS[i]} {jour.getUTCDate()}
                        {auj && <span className="ml-1 sm:hidden">· auj.</span>}
                      </div>
                      {shift ? (
                        <div className="min-w-0 flex-1 sm:mt-1">
                          <div className="text-sm font-semibold sm:text-xs">{shift.nom}</div>
                          {shift.heureDebut && shift.heureFin && (
                            <div className="text-sm tabular-nums text-muted-foreground sm:text-[11px]">{shift.heureDebut} – {shift.heureFin}</div>
                          )}
                        </div>
                      ) : (
                        <div className="flex-1 text-sm text-muted-foreground sm:mt-2 sm:text-xs">Repos</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Les horaires peuvent être ajustés par la Direction. En cas de doute, rapprochez-vous d&apos;elle.</p>

      {/* Heures effectuées */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">Mes heures faites</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">Cette semaine</p>
            <p className="text-2xl font-semibold tabular-nums">{totalSemaine > 0 ? fmtH(totalSemaine) : "—"}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs capitalize text-muted-foreground">Total {moisLabel}</p>
            <p className="text-2xl font-semibold tabular-nums">{totalMois > 0 ? fmtH(totalMois) : "—"}</p>
          </div>
        </div>
        {heuresMois.length > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Détail jour par jour ({moisLabel})</summary>
            <ul className="mt-2 divide-y text-sm">
              {heuresMois.map((h) => (
                <li key={iso(new Date(h.date))} className="flex items-center justify-between py-1.5">
                  <span className="capitalize">{new Date(h.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</span>
                  <span className="font-medium tabular-nums">{fmtH(Number(h.heuresTravaillees))}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Aucune heure enregistrée ce mois-ci. Pensez à <Link href="/espace/pointer" className="font-medium text-primary underline">pointer</Link> à l&apos;arrivée et au départ.</p>
        )}
      </div>


      <Link href="/espace/echanges" className="flex items-center gap-3 rounded-2xl border bg-card p-4 transition hover:border-primary hover:bg-accent">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icone nom="echanges" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Besoin de changer un shift ?</span>
          <span className="block text-xs text-muted-foreground">Échangez avec un collègue, ou demandez un autre horaire à la Direction.</span>
        </span>
      </Link>
    </div>
  );
}
