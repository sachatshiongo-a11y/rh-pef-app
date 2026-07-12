import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { JourMobileProvider } from "@/components/jour-mobile";
import { PlanningMensuel, type CreneauJour } from "./planning-mensuel";
import { ModeleGrid, type ModeleEmployee } from "./modele-grid";
import { ShiftsManager } from "./shifts-manager";
import { BesoinsManager } from "./besoins-manager";
import { PolyvalenceManager } from "./polyvalence-manager";
import { AutoPlanningForm } from "./auto-planning-form";
import { PlanningSemaine, type SemaineEmployee } from "./planning-semaine";
import { paletteDe, libelleShift, type ShiftDTO } from "./creneaux";
import { joursEnConge } from "@/lib/conges-couverture";

import { lundiDe as lundiDeLaSemaine } from "@/lib/dates-fr";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const WD = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const MOIS_LONG = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

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
  // « Aujourd'hui » = date civile à Kinshasa (UTC+1), pas l'heure UTC du serveur : évite le décalage
  // d'un jour entre 23h et minuit UTC. Le reste des dates est stocké en UTC minuit du bon jour.
  const isoAujourdhui = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kinshasa" }).format(new Date());
  const maintenant = new Date(isoAujourdhui + "T00:00:00Z");

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

  // Config des effectifs requis (shift × poste × jour) qui pilote la génération auto « couverture ».
  const [postesRows, besoinsRows, polyvalences] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, select: { poste: true }, distinct: ["poste"], orderBy: { poste: "asc" } }),
    prisma.besoinShift.findMany(),
    prisma.polyvalencePoste.findMany({ orderBy: [{ posteCible: "asc" }, { posteSource: "asc" }] }),
  ]);
  const postesBesoin = postesRows.map((p) => p.poste).filter(Boolean);
  const shiftsBesoin = shifts.filter((s) => s.actif && !s.systeme).map((s) => ({ id: s.id, nom: s.nom }));
  const besoinsDTO = besoinsRows.map((b) => ({ shiftId: b.shiftId, poste: b.poste, jourSemaine: b.jourSemaine, nombreRequis: b.nombreRequis }));
  const besoinsPanel = peutModifier ? (
    <div className="space-y-2">
      <BesoinsManager shifts={shiftsBesoin} postes={postesBesoin} besoins={besoinsDTO} />
      <PolyvalenceManager postes={postesBesoin} polyvalences={polyvalences.map((p) => ({ id: p.id, posteSource: p.posteSource, posteCible: p.posteCible }))} />
    </div>
  ) : null;

  // Onglets de vue — chaque lien conserve la période courante (semaine/mois) pour ne pas perdre le
  // contexte temporel en changeant de vue. `renderOnglets` est appelé dans chaque branche avec les
  // liens adaptés à la période affichée.
  const renderOnglets = (semaineHref: string, moisHref: string) => (
    <div className="flex overflow-hidden rounded-md border text-sm">
      <Link href={semaineHref} className={`px-3 py-1.5 ${vue === "semaine" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
        Semaine
      </Link>
      <Link href={moisHref} className={`px-3 py-1.5 ${vue === "mois" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
        Mois
      </Link>
      <Link href="/planning?vue=modele" className={`px-3 py-1.5 ${vue === "modele" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
        Modèle hebdo
      </Link>
    </div>
  );
  const ongletsDefaut = renderOnglets("/planning?vue=semaine", "/planning?vue=mois");

  // Bouton de génération auto : rendu inline (un composant défini dans le rendu serait remonté à chaque rendu).
  const shiftsPourAuto = shiftsActifs.map((s) => ({ id: s.id, nom: s.nom }));

  const legende = (
    <details className="mb-4">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Légende des shifts</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        {shiftsActifs.map((s) => (
          <span key={s.id} className={`rounded-md px-2 py-1 text-xs ${paletteDe(s.couleur).classe}`}>
            {libelleShift(s.nom, s.heureDebut, s.heureFin)}
          </span>
        ))}
      </div>
    </details>
  );

  // Panneaux de configuration (shifts + effectifs requis) regroupés côte à côte pour épurer la vue.
  const configPanels = peutModifier ? (
    <div className="mb-4 grid items-start gap-3 md:grid-cols-2">
      <ShiftsManager shifts={shifts} peutModifier={peutModifier} />
      {besoinsPanel}
    </div>
  ) : null;

  // -------------------------------------------------------------- VUE MODÈLE
  if (vue === "modele") {
    const [employees, modeles, params] = await Promise.all([
      prisma.employee.findMany({
        where: { actif: true },
        orderBy: [{ categorie: "asc" }, { nom: "asc" }],
        select: { id: true, nom: true, photoUrl: true, salaireMensuel: true, heuresParJour: true, heuresHebdomadaires: true },
      }),
      prisma.planningModele.findMany(),
      chargerParametresPaie(),
    ]);
    const modeleMap: Record<string, string> = {};
    for (const m of modeles) modeleMap[`${m.employeeId}_${m.jour}_${m.semaine}`] = m.shiftId;
    // Taux horaire par défaut = salaire mensuel ÷ (heures/semaine × 52/12) — précis.
    const tauxDefautParEmp: Record<string, number> = {};
    for (const e of employees) {
      const denom = ((Number(e.heuresHebdomadaires) || Number(e.heuresParJour) * 6) * 52) / 12;
      tauxDefautParEmp[e.id] = denom > 0 ? Number(e.salaireMensuel) / denom : 0;
    }

    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">Modèle hebdomadaire</h1>
            <p className="text-sm text-muted-foreground">Le shift/rôle habituel de chaque employé, par jour de la semaine</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">{ongletsDefaut}</div>
        </div>

        {legende}

        <ModeleGrid employees={employees.map((e): ModeleEmployee => ({ id: e.id, nom: e.nom, photoUrl: e.photoUrl }))} shifts={shiftsActifs} modeleMap={modeleMap} tauxDefautParEmp={tauxDefautParEmp} peutModifier={peutModifier} />

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

    const [employeesRaw, creneaux, feries] = await Promise.all([
      prisma.employee.findMany({
        where: { actif: true },
        orderBy: [{ categorie: "asc" }, { nom: "asc" }],
        select: { id: true, nom: true, categorie: true, photoUrl: true, poste: true, heuresHebdomadaires: true },
      }),
      prisma.planningCreneau.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    ]);
    const employees = employeesRaw.map((e) => ({ ...e, heuresHebdomadaires: Number(e.heuresHebdomadaires) }));
    const nomParEmp = new Map(employees.map((e) => [e.id, e.nom]));
    const feriesIso = new Set(feries.map((f) => isoJour(new Date(f.date))));
    const labelsJours = dates.map((d) => `${WD[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}`);

    const creneauMap: Record<string, string> = {};
    const autoMois: string[] = [];
    const creneauxParJour: Record<string, CreneauJour[]> = {};
    for (const c of creneaux) {
      const key = isoJour(new Date(c.date));
      const cle = `${c.employeeId}_${key}`;
      creneauMap[cle] = c.shiftId;
      if (c.genereAuto) autoMois.push(cle);
      const s = shiftParId.get(c.shiftId);
      if (s && s.actif)
        (creneauxParJour[key] ??= []).push({ nom: nomParEmp.get(c.employeeId) ?? "—", shift: libelleShift(s.nom, s.heureDebut, s.heureFin), couleur: s.couleur });
    }

    // Congés approuvés du mois → cellules « Absence ».
    const congeMoisSet = await joursEnConge(employees.flatMap((e) => isoDates.map((iso) => ({ employeeId: e.id, date: iso }))));
    const absencesMois = [...congeMoisSet].map((k) => k.replace("|", "_"));

    const versSemaineEmpMois = (e: (typeof employees)[number]): SemaineEmployee => ({ id: e.id, nom: e.nom, photoUrl: e.photoUrl, heuresHebdo: Number(e.heuresHebdomadaires) });
    const joursMois = dates.map((d, i) => ({
      iso: isoDates[i], label: labelsJours[i], dow: d.getUTCDay(),
      ferie: feriesIso.has(isoDates[i]), dimanche: d.getUTCDay() === 0, aujourdhui: isoDates[i] === isoAujourdhui,
    }));
    const besoinsMois = besoinsDTO.map((b) => ({ shiftId: b.shiftId, jourSemaine: b.jourSemaine, nombreRequis: b.nombreRequis }));

    const moisPrec = mois === 1 ? { m: 12, a: annee - 1 } : { m: mois - 1, a: annee };
    const moisSuiv = mois === 12 ? { m: 1, a: annee + 1 } : { m: mois + 1, a: annee };
    const brigade = employees.filter((e) => e.categorie === "BRIGADE").map(versSemaineEmpMois);
    const backoffice = employees.filter((e) => e.categorie === "BACKOFFICE").map(versSemaineEmpMois);

    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">Planning mensuel</h1>
            <p className="text-sm capitalize text-muted-foreground">{MOIS_LONG[mois - 1]} {annee}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {renderOnglets(`/planning?debut=${isoJour(lundiDeLaSemaine(new Date(Date.UTC(annee, mois - 1, 15))))}`, `/planning?vue=mois&mois=${mois}&annee=${annee}`)}
            {peutModifier && <AutoPlanningForm debut={isoDates[0]} fin={isoDates[isoDates.length - 1]} shifts={shiftsPourAuto} />}
            <Link href={`/planning?vue=mois&mois=${moisPrec.m}&annee=${moisPrec.a}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">← Préc.</Link>
            <Link href="/planning?vue=mois" className="rounded-md border px-3 py-1.5 hover:bg-accent">Ce mois</Link>
            <Link href={`/planning?vue=mois&mois=${moisSuiv.m}&annee=${moisSuiv.a}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">Suiv. →</Link>
          </div>
        </div>

        {configPanels}
        {legende}

        {/* Aperçu calendrier (lecture) — replié par défaut, la grille éditable ci-dessous fait foi */}
        <details className="mb-6">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Aperçu calendrier du mois</summary>
          <div className="mt-3">
            <PlanningMensuel mois={mois} annee={annee} creneauxParJour={creneauxParJour} feriesIso={feriesIso} isoAujourdhui={isoAujourdhui} />
          </div>
        </details>

        {/* Grille éditable du mois — cartes de shift (défilement horizontal) */}
        {employees.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun employé actif.</p>
        ) : (
          <JourMobileProvider defaultIdx={Math.max(0, isoDates.indexOf(isoAujourdhui))}>
            <PlanningSemaine
              groupes={[{ titre: "Brigade", employees: brigade }, { titre: "Backoffice", employees: backoffice }]}
              jours={joursMois}
              creneauMap={creneauMap}
              absences={absencesMois}
              autoSet={autoMois}
              shifts={shiftsActifs}
              besoins={besoinsMois}
              peutModifier={peutModifier}
              colJour={104}
              afficherContrat={false}
            />
          </JourMobileProvider>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          Vue mensuelle éditable (la grille défile horizontalement). ✨ = créneau posé par la
          génération automatique. « Générer automatiquement » remplit les jours ouvrables selon les
          heures de chaque employé sans écraser vos saisies.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------- VUE SEMAINE
  const base = sp.debut ? new Date(sp.debut + "T00:00:00Z") : maintenant;
  const lundi = lundiDeLaSemaine(isNaN(base.getTime()) ? maintenant : base);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const isoDates = dates.map(isoJour);
  const debutSemaine = dates[0];
  const finSemaine = dates[6];

  const [employeesRaw, creneaux, feriesDuMois] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: { id: true, nom: true, categorie: true, photoUrl: true, poste: true, heuresHebdomadaires: true },
    }),
    prisma.planningCreneau.findMany({ where: { date: { gte: debutSemaine, lte: finSemaine } } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutSemaine, lte: finSemaine } } }),
  ]);
  // Decimal → number dès la source : aucun objet Prisma non sérialisable ne franchit la frontière client.
  const employees = employeesRaw.map((e) => ({ ...e, heuresHebdomadaires: Number(e.heuresHebdomadaires) }));

  const feriesIso = new Set(feriesDuMois.map((f) => isoJour(new Date(f.date))));

  const creneauMap: Record<string, string> = {};
  const autoSemaine: string[] = [];
  for (const c of creneaux) {
    const key = `${c.employeeId}_${isoJour(new Date(c.date))}`;
    creneauMap[key] = c.shiftId;
    if (c.genereAuto) autoSemaine.push(key);
  }

  // Congés approuvés de la semaine → cellules « Absence ».
  const congeSet = await joursEnConge(employees.flatMap((e) => isoDates.map((iso) => ({ employeeId: e.id, date: iso }))));
  const absencesSemaine = [...congeSet].map((k) => k.replace("|", "_"));

  const labelsJours = dates.map((d, i) => `${JOURS[i]} ${String(d.getUTCDate()).padStart(2, "0")}`);
  const semainePrec = isoJour(new Date(lundi.getTime() - 7 * 86_400_000));
  const semaineSuiv = isoJour(new Date(lundi.getTime() + 7 * 86_400_000));
  const titrePeriode = `${debutSemaine.getUTCDate()} → ${finSemaine.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;

  const versSemaineEmp = (e: (typeof employees)[number]): SemaineEmployee => ({ id: e.id, nom: e.nom, photoUrl: e.photoUrl, heuresHebdo: Number(e.heuresHebdomadaires) });
  const brigade = employees.filter((e) => e.categorie === "BRIGADE").map(versSemaineEmp);
  const backoffice = employees.filter((e) => e.categorie === "BACKOFFICE").map(versSemaineEmp);
  const joursSemaine = dates.map((d, i) => ({
    iso: isoDates[i], label: labelsJours[i], dow: d.getUTCDay(),
    ferie: feriesIso.has(isoDates[i]), dimanche: d.getUTCDay() === 0, aujourdhui: isoDates[i] === isoAujourdhui,
  }));
  const besoinsSemaine = besoinsDTO.map((b) => ({ shiftId: b.shiftId, jourSemaine: b.jourSemaine, nombreRequis: b.nombreRequis }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Planning hebdomadaire</h1>
          <p className="text-sm text-muted-foreground">Semaine du {titrePeriode}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {renderOnglets(`/planning?debut=${isoDates[0]}`, `/planning?vue=mois&mois=${dates[3].getUTCMonth() + 1}&annee=${dates[3].getUTCFullYear()}`)}
          {peutModifier && <AutoPlanningForm debut={isoDates[0]} fin={isoDates[6]} shifts={shiftsPourAuto} />}
          <Link href={`/planning?debut=${semainePrec}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">← Préc.</Link>
          <Link href="/planning" className="rounded-md border px-3 py-1.5 hover:bg-accent">Cette semaine</Link>
          <Link href={`/planning?debut=${semaineSuiv}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">Suiv. →</Link>
        </div>
      </div>

      {configPanels}
      {legende}

      {employees.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun employé actif.</p>
      ) : (
        <JourMobileProvider defaultIdx={Math.max(0, isoDates.indexOf(isoAujourdhui))}>
          <PlanningSemaine
            groupes={[{ titre: "Brigade", employees: brigade }, { titre: "Backoffice", employees: backoffice }]}
            jours={joursSemaine}
            creneauMap={creneauMap}
            absences={absencesSemaine}
            autoSet={autoSemaine}
            shifts={shiftsActifs}
            besoins={besoinsSemaine}
            peutModifier={peutModifier}
          />
        </JourMobileProvider>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Planning prévisionnel. Le shift « Nuit » est indicatif :{" "}
        <span className="font-medium">aucune majoration de nuit</span> n&apos;est appliquée en paie.
        Colonne surlignée = dimanche ou jour férié.
      </p>
    </div>
  );
}
