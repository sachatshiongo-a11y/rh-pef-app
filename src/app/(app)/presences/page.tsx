import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { calculerHeuresSupp, numeroSemaineDuMois, type CodePresence, type DetailSemaineHS } from "@/lib/payroll";
import { TempsGrid, type EmployeeRow } from "./temps-grid";
import { JourMobileProvider } from "@/components/jour-mobile";
import { COULEUR_CODE } from "./attendance-colors";
import { ImportPointage } from "./import-pointage";
import { WeeklyBreakdownTable } from "../heures-supp/weekly-breakdown-table";

// Chaque code = couleur + libellé + icône (jamais la couleur seule — D).
const LEGENDE: { code: CodePresence; icone: string; label: string }[] = [
  { code: "P", icone: "✓", label: "Présence — payé 100%" },
  { code: "O", icone: "☕", label: "Repos — payé 100%" },
  { code: "M", icone: "✚", label: "Maladie — payé 2/3" },
  { code: "A", icone: "📄", label: "Absence justifiée — payé 100%" },
  { code: "N", icone: "✕", label: "Absence non justifiée — non payé" },
  { code: "C", icone: "🏖", label: "Congé payé — 100%" },
  { code: "F", icone: "★", label: "Jour férié — payé 100%" },
  { code: "S", icone: "∅", label: "Congé sans solde — non payé" },
];

export default async function PresencesPage() {
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

  const [employees, attendances, entries, joursFeriesDuMois] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" } }),
    prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
  ]);

  const joursFeries = new Set(
    joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10))
  );

  const attendanceMap: Record<string, string> = {};
  for (const a of attendances) {
    attendanceMap[`${a.employeeId}_${new Date(a.date).getUTCDate()}`] = a.code;
  }
  const hoursMap: Record<string, number> = {};
  const joursParEmploye: Record<string, { date: Date; heuresTravaillees: number }[]> = {};
  for (const o of entries) {
    const h = Number(o.heuresTravaillees);
    hoursMap[`${o.employeeId}_${new Date(o.date).getUTCDate()}`] = h;
    (joursParEmploye[o.employeeId] ??= []).push({ date: new Date(o.date), heuresTravaillees: h });
  }

  // Détail hebdomadaire (HS par semaine) — calculé côté serveur pour le tableau replié.
  const semainesParEmploye: Record<string, DetailSemaineHS[]> = {};
  const toRow = (e: (typeof employees)[number]): EmployeeRow => {
    const salaireJournalier = Number(e.salaireMensuel) / parametres.joursOuvrablesMois;
    const salaireHoraire = salaireJournalier / Number(e.heuresParJour);
    return {
      id: e.id,
      matricule: e.matricule,
      nom: e.nom,
      photoUrl: e.photoUrl,
      heuresParJour: Number(e.heuresParJour),
      heuresHebdo: Number(e.heuresHebdomadaires),
      salaireHoraire,
    };
  };
  const rows = employees.map(toRow);
  for (const r of rows) {
    semainesParEmploye[r.id] = calculerHeuresSupp({
      jours: joursParEmploye[r.id] ?? [],
      heuresParJourContrat: r.heuresParJour,
      heuresHebdoContrat: r.heuresHebdo,
      salaireHoraire: r.salaireHoraire,
      joursFeries,
      params: parametres,
    }).semaines;
  }

  const brigade = rows.filter((r) => employees.find((e) => e.id === r.id)?.categorie === "BRIGADE");
  const backoffice = rows.filter((r) => employees.find((e) => e.id === r.id)?.categorie === "BACKOFFICE");

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Présences &amp; heures</h1>
          <p className="text-sm capitalize text-muted-foreground">{periode}</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Chaque case du mois porte le <b>code du jour</b> (couleur) et les <b>heures travaillées</b>.
            Cliquez une case pour ouvrir le menu (code + heures), ou tapez directement une lettre
            (P, O, M, A, N, C, F, S) — Suppr efface, flèches pour naviguer. Les 6 premières heures
            supp. de la semaine sont majorées à 30%, le reste à 60% ; dimanche et fériés, toutes les
            heures sont payées double.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/presences/export" className="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
            Excel présences
          </a>
          <a href="/heures-supp/export" className="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
            Excel heures
          </a>
        </div>
      </div>

      {peutModifier && <ImportPointage />}

      <div className="mb-4 flex flex-wrap gap-2">
        {LEGENDE.map((l) => (
          <span key={l.code} className={`rounded-md px-2 py-1 text-xs ${COULEUR_CODE[l.code]}`}>
            <span aria-hidden>{l.icone}</span>{" "}
            <span className="font-semibold">{l.code}</span> = {l.label}
          </span>
        ))}
        <span className="rounded-md bg-orange-100 px-2 py-1 text-xs text-orange-800">
          Colonne surlignée = dimanche ou jour férié (heures payées double)
        </span>
      </div>

      <JourMobileProvider defaultIdx={Math.max(0, isoDates.indexOf(new Date().toISOString().slice(0, 10)))}>
        <div className="mb-8">
          <h2 className="mb-3 text-base font-semibold">Brigade</h2>
          <TempsGrid
            employees={brigade}
            days={days}
            attendanceMap={attendanceMap}
            hoursMap={hoursMap}
            peutModifier={peutModifier}
            isoDates={isoDates}
            joursFeries={joursFeries}
            params={parametres}
          />
        </div>

        <div>
          <h2 className="mb-3 text-base font-semibold">Backoffice</h2>
          <TempsGrid
            employees={backoffice}
            days={days}
            attendanceMap={attendanceMap}
            hoursMap={hoursMap}
            peutModifier={peutModifier}
            isoDates={isoDates}
            joursFeries={joursFeries}
            params={parametres}
          />
        </div>
      </JourMobileProvider>

      <details className="mt-8 rounded-xl border">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
          Détail hebdomadaire des heures supplémentaires
        </summary>
        <div className="border-t p-5">
          <WeeklyBreakdownTable
            employees={rows}
            semainesParEmploye={semainesParEmploye}
            nbSemaines={nbSemaines}
          />
        </div>
      </details>
    </div>
  );
}
