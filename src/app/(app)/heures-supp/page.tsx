import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { calculerHeuresSupp, numeroSemaineDuMois, type DetailSemaineHS } from "@/lib/payroll";
import { HoursGrid, type EmployeeRow, type ResumeHS } from "./hours-grid";
import { WeeklyBreakdownTable } from "./weekly-breakdown-table";

export default async function HeuresSuppPage() {
  const user = await verifySession();
  const peutModifier = user.role === "ADMIN" || user.role === "MANAGER";

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const parametres = await chargerParametresPaie();
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const annee = config?.anneeCourante ?? new Date().getFullYear();

  const nbJours = new Date(annee, mois, 0).getDate();
  const days = Array.from({ length: nbJours }, (_, i) => i + 1);
  const isoDates = days.map(
    (d) => `${annee}-${String(mois).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  );
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const nbSemaines = numeroSemaineDuMois(new Date(Date.UTC(annee, mois - 1, nbJours)));

  const [employees, entries, joursFeriesDuMois] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" } }),
    prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
  ]);

  const joursFeries = new Set(
    joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10))
  );

  const hoursMap: Record<string, number> = {};
  const joursParEmploye: Record<string, { date: Date; heuresTravaillees: number }[]> = {};
  for (const o of entries) {
    const day = new Date(o.date).getUTCDate();
    const h = Number(o.heuresTravaillees);
    hoursMap[`${o.employeeId}_${day}`] = h;
    (joursParEmploye[o.employeeId] ??= []).push({ date: new Date(o.date), heuresTravaillees: h });
  }

  const resumes: Record<string, ResumeHS> = {};
  const semainesParEmploye: Record<string, DetailSemaineHS[]> = {};
  for (const e of employees) {
    const salaireJournalier = Number(e.salaireMensuel) / parametres.joursOuvrablesMois;
    const salaireHoraire = salaireJournalier / Number(e.heuresParJour);
    const hs = calculerHeuresSupp({
      jours: joursParEmploye[e.id] ?? [],
      heuresParJourContrat: Number(e.heuresParJour),
      heuresHebdoContrat: Number(e.heuresHebdomadaires),
      salaireHoraire,
      joursFeries,
      params: parametres,
    });
    resumes[e.id] = {
      heuresTotalesMois: hs.heuresTotalesMois,
      totalHS: hs.totalHS,
      hs30: hs.hs30,
      hs60: hs.hs60,
      hs100: hs.hs100,
      hsValorisee: hs.hsValorisee,
    };
    semainesParEmploye[e.id] = hs.semaines;
  }

  const employeeRows: EmployeeRow[] = employees.map((e) => ({
    id: e.id,
    nom: e.nom,
    heuresParJour: Number(e.heuresParJour),
    photoUrl: e.photoUrl,
  }));

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Heures supplémentaires</h1>
          <p className="text-sm text-muted-foreground capitalize">{periode}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Saisissez les heures réellement travaillées par jour. Les 6 premières heures supp. de la
            semaine (au-delà de l&apos;horaire hebdomadaire contractuel) sont majorées à 30%, le
            reste à 60% — le dimanche et les jours fériés, <span className="font-medium">toutes</span>{" "}
            les heures sont payées double (prime +100%), hors tranches 30/60. Flèches du clavier pour
            naviguer, collage type tableur pour saisir plusieurs jours/employés d&apos;un coup.
          </p>
        </div>
        <a
          href="/heures-supp/export"
          className="whitespace-nowrap rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Exporter Excel
        </a>
      </div>

      <HoursGrid
        employees={employeeRows}
        days={days}
        hoursMap={hoursMap}
        resumes={resumes}
        semainesParEmploye={semainesParEmploye}
        peutModifier={peutModifier}
        isoDates={isoDates}
        joursFeries={joursFeries}
      />

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold">Détail hebdomadaire</h2>
        <WeeklyBreakdownTable
          employees={employeeRows}
          semainesParEmploye={semainesParEmploye}
          nbSemaines={nbSemaines}
        />
      </div>
    </div>
  );
}
