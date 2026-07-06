import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { PlanningGrid, type EmployeeRow } from "./planning-grid";
import { PlanningMensuel, type CreneauJour } from "./planning-mensuel";
import { ModeleGrid, type ModeleEmployee } from "./modele-grid";
import { ShiftsManager } from "./shifts-manager";
import { AutoPlanningForm } from "./auto-planning-form";
import { paletteDe, libelleShift, type ShiftDTO } from "./creneaux";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const WD = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const MOIS_LONG = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function lundiDeLaSemaine(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const jour = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (jour === 0 ? -6 : 1 - jour));
  return date;
}
function isoJour(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ debut?: string; vue?: string; mois?: string; annee?: string }>;
}) {
  const user = await verifySession();
  const peutModifier = user.role === "ADMIN" || user.role === "MANAGER";
  const sp = await searchParams;
  const vue = sp.vue === "mois" ? "mois" : sp.vue === "modele" ? "modele" : "semaine";
  const maintenant = new Date();
  const nowUTC = new Date();
  const isoAujourdhui = isoJour(new Date(Date.UTC(nowUTC.getFullYear(), nowUTC.getMonth(), nowUTC.getDate())));

  const shifts = await prisma.shift.findMany({ orderBy: { ordre: "asc" } });
  const shiftsActifs: ShiftDTO[] = shifts
    .filter((s) => s.actif)
    .map((s) => ({
      id: s.id,
      nom: s.nom,
      heureDebut: s.heureDebut,
      heureFin: s.heureFin,
      couleur: s.couleur,
      ordre: s.ordre,
      systeme: s.systeme,
      actif: s.actif,
      dureeHeures: s.dureeHeures != null ? Number(s.dureeHeures) : null,
      tauxHoraireUSD: s.tauxHoraireUSD != null ? Number(s.tauxHoraireUSD) : null,
    }));
  const shiftParId = new Map(shifts.map((s) => [s.id, s]));

  const onglets = (
    <div className="flex overflow-hidden rounded-md border text-sm">
      <Link href="/planning?vue=semaine" className={`px-3 py-1.5 ${vue === "semaine" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
        Semaine
      </Link>
      <Link href="/planning?vue=mois" className={`px-3 py-1.5 ${vue === "mois" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
        Mois
      </Link>
      <Link href="/planning?vue=modele" className={`px-3 py-1.5 ${vue === "modele" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
        Modèle hebdo
      </Link>
    </div>
  );

  function BoutonAuto({ debut, fin }: { debut: string; fin: string }) {
    if (!peutModifier) return null;
    return <AutoPlanningForm debut={debut} fin={fin} shifts={shiftsActifs.map((s) => ({ id: s.id, nom: s.nom }))} />;
  }

  const legende = (
    <div className="mb-4 flex flex-wrap gap-2">
      {shiftsActifs.map((s) => (
        <span key={s.id} className={`rounded-md px-2 py-1 text-xs ${paletteDe(s.couleur).classe}`}>
          {libelleShift(s.nom, s.heureDebut, s.heureFin)}
        </span>
      ))}
    </div>
  );

  // -------------------------------------------------------------- VUE MODÈLE
  if (vue === "modele") {
    const [employees, modeles, params] = await Promise.all([
      prisma.employee.findMany({
        where: { actif: true },
        orderBy: [{ categorie: "asc" }, { nom: "asc" }],
        select: { id: true, nom: true, photoUrl: true, salaireMensuel: true, heuresParJour: true },
      }),
      prisma.planningModele.findMany(),
      chargerParametresPaie(),
    ]);
    const modeleMap: Record<string, string> = {};
    for (const m of modeles) modeleMap[`${m.employeeId}_${m.jour}`] = m.shiftId;
    // Taux horaire par défaut de chaque employé = salaire mensuel ÷ (heures/jour × jours ouvrables).
    const tauxDefautParEmp: Record<string, number> = {};
    for (const e of employees) {
      const denom = Number(e.heuresParJour) * params.joursOuvrablesMois;
      tauxDefautParEmp[e.id] = denom > 0 ? Number(e.salaireMensuel) / denom : 0;
    }

    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Modèle hebdomadaire</h1>
            <p className="text-sm text-muted-foreground">Le shift/rôle habituel de chaque employé, par jour de la semaine</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">{onglets}</div>
        </div>

        {legende}

        <ModeleGrid employees={employees as ModeleEmployee[]} shifts={shiftsActifs} modeleMap={modeleMap} tauxDefautParEmp={tauxDefautParEmp} peutModifier={peutModifier} />

        <p className="mt-4 text-xs text-muted-foreground">
          Définissez ici, pour chaque employé, le shift/rôle de chaque jour (laissez « repos » les
          jours non travaillés). Exemple : une serveuse le lun/mer/ven et assistante admin le mar/jeu.
          La <span className="font-medium">génération automatique</span> (bouton dans les vues Semaine
          ou Mois) applique ces modèles pour créer un planning précis, sans écraser vos saisies.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- VUE MOIS
  if (vue === "mois") {
    const annee = Number(sp.annee) || maintenant.getFullYear();
    const mois = sp.mois ? Math.min(12, Math.max(1, Number(sp.mois))) : maintenant.getMonth() + 1;
    const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
    const finMois = new Date(Date.UTC(annee, mois, 0));
    const nbJours = finMois.getUTCDate();
    const dates = Array.from({ length: nbJours }, (_, i) => new Date(Date.UTC(annee, mois - 1, i + 1)));
    const isoDates = dates.map(isoJour);

    const [employees, creneaux, feries] = await Promise.all([
      prisma.employee.findMany({
        where: { actif: true },
        orderBy: [{ categorie: "asc" }, { nom: "asc" }],
        select: { id: true, nom: true, categorie: true, photoUrl: true },
      }),
      prisma.planningCreneau.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    ]);
    const nomParEmp = new Map(employees.map((e) => [e.id, e.nom]));
    const feriesIso = new Set(feries.map((f) => isoJour(new Date(f.date))));
    const joursMajores = dates.map((d, i) => d.getUTCDay() === 0 || feriesIso.has(isoDates[i]));
    const labelsJours = dates.map((d) => `${WD[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}`);

    const creneauMap: Record<string, string> = {};
    const creneauxParJour: Record<string, CreneauJour[]> = {};
    for (const c of creneaux) {
      const key = isoJour(new Date(c.date));
      creneauMap[`${c.employeeId}_${key}`] = c.shiftId;
      const s = shiftParId.get(c.shiftId);
      if (s && s.actif)
        (creneauxParJour[key] ??= []).push({ nom: nomParEmp.get(c.employeeId) ?? "—", shift: libelleShift(s.nom, s.heureDebut, s.heureFin), couleur: s.couleur });
    }

    const moisPrec = mois === 1 ? { m: 12, a: annee - 1 } : { m: mois - 1, a: annee };
    const moisSuiv = mois === 12 ? { m: 1, a: annee + 1 } : { m: mois + 1, a: annee };
    const brigade = employees.filter((e) => e.categorie === "BRIGADE") as EmployeeRow[];
    const backoffice = employees.filter((e) => e.categorie === "BACKOFFICE") as EmployeeRow[];

    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Planning mensuel</h1>
            <p className="text-sm capitalize text-muted-foreground">{MOIS_LONG[mois - 1]} {annee}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {onglets}
            <BoutonAuto debut={isoDates[0]} fin={isoDates[isoDates.length - 1]} />
            <Link href={`/planning?vue=mois&mois=${moisPrec.m}&annee=${moisPrec.a}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">← Préc.</Link>
            <Link href="/planning?vue=mois" className="rounded-md border px-3 py-1.5 hover:bg-accent">Ce mois</Link>
            <Link href={`/planning?vue=mois&mois=${moisSuiv.m}&annee=${moisSuiv.a}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">Suiv. →</Link>
          </div>
        </div>

        <ShiftsManager shifts={shifts} peutModifier={peutModifier} />
        {legende}

        {/* Aperçu calendrier (lecture) */}
        <div className="mb-6">
          <PlanningMensuel mois={mois} annee={annee} creneauxParJour={creneauxParJour} feriesIso={feriesIso} isoAujourdhui={isoAujourdhui} />
        </div>

        {/* Grilles éditables du mois (défilement horizontal) */}
        {employees.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun employé actif.</p>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-base font-semibold">Brigade <span className="font-normal text-muted-foreground">({brigade.length})</span></h2>
              <PlanningGrid employees={brigade} isoDates={isoDates} labelsJours={labelsJours} creneauMap={creneauMap} shifts={shiftsActifs} peutModifier={peutModifier} joursMajores={joursMajores} isoAujourdhui={isoAujourdhui} />
            </div>
            <div>
              <h2 className="mb-2 text-base font-semibold">Backoffice <span className="font-normal text-muted-foreground">({backoffice.length})</span></h2>
              <PlanningGrid employees={backoffice} isoDates={isoDates} labelsJours={labelsJours} creneauMap={creneauMap} shifts={shiftsActifs} peutModifier={peutModifier} joursMajores={joursMajores} isoAujourdhui={isoAujourdhui} />
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Vue mensuelle éditable (les grilles défilent horizontalement). Colonne orange = dimanche ou
          jour férié. « Générer automatiquement » remplit les jours ouvrables selon les heures de
          chaque employé sans écraser vos saisies.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------- VUE SEMAINE
  const base = sp.debut ? new Date(sp.debut + "T00:00:00Z") : new Date();
  const lundi = lundiDeLaSemaine(isNaN(base.getTime()) ? new Date() : base);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const isoDates = dates.map(isoJour);
  const debutSemaine = dates[0];
  const finSemaine = dates[6];

  const [employees, creneaux, feriesDuMois] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: { id: true, nom: true, categorie: true, photoUrl: true },
    }),
    prisma.planningCreneau.findMany({ where: { date: { gte: debutSemaine, lte: finSemaine } } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutSemaine, lte: finSemaine } } }),
  ]);

  const feriesIso = new Set(feriesDuMois.map((f) => isoJour(new Date(f.date))));
  const joursMajores = dates.map((d, i) => i === 6 || feriesIso.has(isoDates[i]));

  const creneauMap: Record<string, string> = {};
  for (const c of creneaux) {
    creneauMap[`${c.employeeId}_${isoJour(new Date(c.date))}`] = c.shiftId;
  }

  const labelsJours = dates.map((d, i) => `${JOURS[i]} ${String(d.getUTCDate()).padStart(2, "0")}`);
  const semainePrec = isoJour(new Date(lundi.getTime() - 7 * 86_400_000));
  const semaineSuiv = isoJour(new Date(lundi.getTime() + 7 * 86_400_000));
  const titrePeriode = `${debutSemaine.getUTCDate()} → ${finSemaine.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;

  const brigade = employees.filter((e) => e.categorie === "BRIGADE") as EmployeeRow[];
  const backoffice = employees.filter((e) => e.categorie === "BACKOFFICE") as EmployeeRow[];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Planning hebdomadaire</h1>
          <p className="text-sm text-muted-foreground">Semaine du {titrePeriode}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {onglets}
          <BoutonAuto debut={isoDates[0]} fin={isoDates[6]} />
          <Link href={`/planning?debut=${semainePrec}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">← Préc.</Link>
          <Link href="/planning" className="rounded-md border px-3 py-1.5 hover:bg-accent">Cette semaine</Link>
          <Link href={`/planning?debut=${semaineSuiv}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">Suiv. →</Link>
        </div>
      </div>

      <ShiftsManager shifts={shifts} peutModifier={peutModifier} />
      {legende}

      {employees.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun employé actif.</p>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-base font-semibold">Brigade <span className="font-normal text-muted-foreground">({brigade.length})</span></h2>
            <PlanningGrid employees={brigade} isoDates={isoDates} labelsJours={labelsJours} creneauMap={creneauMap} shifts={shiftsActifs} peutModifier={peutModifier} joursMajores={joursMajores} isoAujourdhui={isoAujourdhui} />
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold">Backoffice <span className="font-normal text-muted-foreground">({backoffice.length})</span></h2>
            <PlanningGrid employees={backoffice} isoDates={isoDates} labelsJours={labelsJours} creneauMap={creneauMap} shifts={shiftsActifs} peutModifier={peutModifier} joursMajores={joursMajores} isoAujourdhui={isoAujourdhui} />
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Planning prévisionnel. Le shift « Nuit » est indicatif :{" "}
        <span className="font-medium">aucune majoration de nuit</span> n&apos;est appliquée en paie.
        Colonne surlignée = dimanche ou jour férié.
      </p>
    </div>
  );
}
