import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { resumerPresences, type CodePresence } from "@/lib/payroll";
import { AttendanceGrid, type EmployeeRow, type ResumeParEmploye } from "./attendance-grid";
import { COULEUR_CODE } from "./attendance-colors";
import { ImportPointage } from "./import-pointage";

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
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const annee = config?.anneeCourante ?? new Date().getFullYear();

  const nbJours = new Date(annee, mois, 0).getDate();
  const days = Array.from({ length: nbJours }, (_, i) => i + 1);
  const isoDates = days.map(
    (d) => `${annee}-${String(mois).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  );
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [employees, attendances, joursFeriesDuMois] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" } }),
    prisma.attendance.findMany({
      where: { date: { gte: debutMois, lte: finMois } },
    }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
  ]);

  const joursFeries = new Set(
    joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10))
  );

  const attendanceMap: Record<string, string> = {};
  const codesParEmploye: Record<string, CodePresence[]> = {};
  for (const a of attendances) {
    const day = new Date(a.date).getUTCDate();
    attendanceMap[`${a.employeeId}_${day}`] = a.code;
    (codesParEmploye[a.employeeId] ??= []).push(a.code as CodePresence);
  }

  const resumes: ResumeParEmploye = {};
  for (const e of employees) {
    resumes[e.id] = resumerPresences(codesParEmploye[e.id] ?? []);
  }

  const toRow = (e: (typeof employees)[number]): EmployeeRow => ({
    id: e.id,
    matricule: e.matricule,
    nom: e.nom,
    photoUrl: e.photoUrl,
  });
  const brigade = employees.filter((e) => e.categorie === "BRIGADE").map(toRow);
  const backoffice = employees.filter((e) => e.categorie === "BACKOFFICE").map(toRow);

  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Présences</h1>
          <p className="text-sm text-muted-foreground capitalize">{periode}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cliquez une case puis tapez directement une lettre (P, O, M, A, N, C, F, S) ou ouvrez la
            liste déroulante. Flèches du clavier pour naviguer, collage type tableur pour saisir
            plusieurs jours/employés d&apos;un coup.
          </p>
        </div>
        <a
          href="/presences/export"
          className="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium"
        >
          Exporter Excel
        </a>
      </div>

      {peutModifier && <ImportPointage />}

      <div className="mb-4 flex flex-wrap gap-2">
        {LEGENDE.map((l) => (
          <span
            key={l.code}
            className={`rounded-md px-2 py-1 text-xs ${COULEUR_CODE[l.code]}`}
          >
            <span aria-hidden>{l.icone}</span>{" "}
            <span className="font-semibold">{l.code}</span> = {l.label}
          </span>
        ))}
        <span className="rounded-md bg-orange-100 px-2 py-1 text-xs text-orange-800">
          Colonne surlignée = dimanche ou jour férié
        </span>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-base font-semibold">Brigade</h2>
        <AttendanceGrid
          employees={brigade}
          days={days}
          attendanceMap={attendanceMap}
          resumes={resumes}
          peutModifier={peutModifier}
          isoDates={isoDates}
          joursFeries={joursFeries}
        />
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Backoffice</h2>
        <AttendanceGrid
          employees={backoffice}
          days={days}
          attendanceMap={attendanceMap}
          resumes={resumes}
          peutModifier={peutModifier}
          isoDates={isoDates}
          joursFeries={joursFeries}
        />
      </div>
    </div>
  );
}
