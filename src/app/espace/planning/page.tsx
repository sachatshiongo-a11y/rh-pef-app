import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { lundiDe, MOIS_FR } from "@/lib/dates-fr";
import { demanderChangementShift } from "../actions";
import { Icone } from "@/components/icones";

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const BADGE: Record<string, { label: string; classe: string }> = {
  EN_ATTENTE: { label: "En attente", classe: "bg-amber-100 text-amber-800" },
  APPROUVE: { label: "Approuvé", classe: "bg-emerald-100 text-emerald-800" },
  REFUSE: { label: "Refusé", classe: "bg-red-100 text-red-800" },
};

function iso(d: Date) { return d.toISOString().slice(0, 10); }
function addJours(base: Date, n: number) { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d; }
function fmtH(h: number) {
  const heures = Math.floor(h);
  const min = Math.round((h - heures) * 60);
  return `${heures}h ${String(min).padStart(2, "0")}m`;
}
const jourLong = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function EspacePlanning({ searchParams }: { searchParams: Promise<{ echange?: string; erreur?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;
  const lundiCourant = lundiDe(new Date(Date.now() + 3_600_000));
  // 4 semaines à venir (courante incluse) — on n'affiche QUE celles publiées par la Direction.
  const semaines = [0, 1, 2, 3].map((i) => addJours(lundiCourant, i * 7));
  const fin = addJours(semaines[semaines.length - 1], 6);

  // Heures RÉELLEMENT effectuées : mois civil en cours (heure de Kinshasa).
  const k = new Date(Date.now() + 3_600_000);
  const today = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const debutMois = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1));
  const finMois = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0));

  const [emp, creneaux, publiees, heuresMois, shiftsActifs, mesDemandes] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: s.employeeId }, select: { poste: true } }),
    prisma.planningCreneau.findMany({
      where: { employeeId: s.employeeId, date: { gte: lundiCourant, lte: fin } },
      select: { date: true, shiftId: true, shift: { select: { nom: true, heureDebut: true, heureFin: true } } },
    }),
    prisma.semainePubliee.findMany({ where: { lundi: { gte: lundiCourant, lte: fin } }, select: { lundi: true } }),
    prisma.overtimeEntry.findMany({
      where: { employeeId: s.employeeId, date: { gte: debutMois, lte: finMois } },
      select: { date: true, heuresTravaillees: true },
      orderBy: { date: "asc" },
    }),
    prisma.shift.findMany({ where: { actif: true, systeme: false }, orderBy: { ordre: "asc" }, select: { id: true, nom: true, heureDebut: true, heureFin: true } }),
    prisma.demandeChangementShift.findMany({ where: { employeeId: s.employeeId }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const publieeSet = new Set(publiees.map((p) => iso(new Date(p.lundi))));
  const parJour = new Map(creneaux.map((c) => [iso(new Date(c.date)), c.shift]));
  const isoAuj = iso(new Date());

  // Shifts « correspondant au poste » (via les besoins définis) ; à défaut, tous les shifts de travail.
  const besoins = await prisma.besoinShift.findMany({ where: { poste: emp.poste }, select: { shiftId: true } });
  const idsBesoin = new Set(besoins.map((b) => b.shiftId));
  const shiftsCibles = shiftsActifs.filter((sh) => idsBesoin.size === 0 || idsBesoin.has(sh.id));
  const shiftNom = new Map(shiftsActifs.map((sh) => [sh.id, sh.nom]));

  // Créneaux À VENIR d'une semaine publiée → éligibles à une demande de changement.
  const creneauxChangeables = creneaux
    .filter((c) => new Date(c.date) >= today && publieeSet.has(lundiDe(new Date(c.date)).toISOString().slice(0, 10)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
        <h1 className="text-xl font-semibold">Planning &amp; heures</h1>
        <p className="text-sm text-muted-foreground">Vos services publiés et vos heures réellement effectuées.</p>
      </div>

      {/* Heures effectuées */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">Mes heures effectuées</h2>
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
          <p className="mt-3 text-sm text-muted-foreground">Aucune heure enregistrée ce mois-ci. Pensez à <b>pointer</b> vos journées.</p>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-base font-semibold">Mon planning</h2>
        <p className="mb-3 text-sm text-muted-foreground">Vos services des semaines publiées par la Direction.</p>
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

      {/* Demande de changement de shift */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Icone nom="echanges" className="shrink-0 text-primary" /> Demander un changement de shift</h2>
        <p className="mb-3 text-sm text-muted-foreground">Sur un service à venir, demandez un autre shift correspondant à votre poste. La Direction validera.</p>

        {sp.echange && <p className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Votre demande de changement a été envoyée à la Direction.</p>}
        {sp.erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

        {creneauxChangeables.length === 0 || shiftsCibles.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            {creneauxChangeables.length === 0 ? "Aucun service publié à venir sur lequel demander un changement." : "Aucun shift alternatif disponible pour votre poste."}
          </p>
        ) : (
          <form action={demanderChangementShift} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">Jour concerné
              <select name="date" required className="rounded-md border border-input bg-background px-3 py-2 text-sm">
                {creneauxChangeables.map((c) => (
                  <option key={iso(new Date(c.date))} value={iso(new Date(c.date))}>
                    {jourLong(c.date)} — actuellement {c.shift.nom}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Shift souhaité
              <select name="shiftDemandeId" required className="rounded-md border border-input bg-background px-3 py-2 text-sm">
                {shiftsCibles.map((sh) => (
                  <option key={sh.id} value={sh.id}>{sh.nom}{sh.heureDebut && sh.heureFin ? ` (${sh.heureDebut}–${sh.heureFin})` : ""}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">Motif (facultatif)
              <input type="text" name="motif" placeholder="ex. contrainte personnelle" className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </label>
            <div className="sm:col-span-2">
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Envoyer la demande</button>
            </div>
          </form>
        )}

        {mesDemandes.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">Mes demandes de changement</h3>
            <ul className="divide-y">
              {mesDemandes.map((dem) => {
                const b = BADGE[dem.statut] ?? { label: dem.statut, classe: "bg-muted text-muted-foreground" };
                return (
                  <li key={dem.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize">{jourLong(dem.date)}</p>
                      <p className="text-xs text-muted-foreground">
                        {dem.shiftActuelId ? `${shiftNom.get(dem.shiftActuelId) ?? "—"} → ` : "→ "}{shiftNom.get(dem.shiftDemandeId) ?? "—"}{dem.motif ? ` · ${dem.motif}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
