import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import { calculerHeuresSupp, numeroSemaineDuMois, type CodePresence, type DetailSemaineHS } from "@/lib/payroll";
import { hsValoriseesPaie, hsValoriseesFigees } from "@/lib/hs-valorisees-paie";
import { chargerHeuresAvantMois } from "@/lib/heures-avant-mois";
import { datesDeSortie, inactifsDeLaPeriode } from "@/lib/salaries-sortis";
import { TempsGrid, type EmployeeRow, type InfoShift } from "./temps-grid";
import { BarreVuePresences, PresencesVueProvider, type VuePresences } from "./vue-presences";
import { semaineParDefaut, semainesDuMois } from "./semaines";
import { peutSupprimer } from "@/lib/suppression-direction";
import { JourMobileProvider } from "@/components/jour-mobile";
import { COULEUR_CODE } from "./attendance-colors";
import { ImportPointage } from "./import-pointage";
import { rattraperCodesConges } from "@/lib/conges-presences";
import { WeeklyBreakdownTable } from "../heures-supp/weekly-breakdown-table";
import { exigerPageRH } from "@/lib/garde-page";
import { chargerHorairesDuMois } from "@/lib/horaires-presences";
import { PAUSE_PAR_DEFAUT_MIN } from "@/lib/pointage-qr";
import { TelechargerLien } from "@/components/telecharger-lien";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { bornesNavigation, requeteMois, resoudreMoisPresences } from "@/lib/presences-mois";
import { lirePeriodeCouranteRH, premierMoisAvecDonnees } from "@/lib/presences-mois-serveur";
import { NavigationMoisPresences } from "./navigation-mois";
import Link from "next/link";

// Chaque code = couleur + libellé + icône (jamais la couleur seule — D).
const LEGENDE: { code: CodePresence; icone: string; label: string }[] = [
  { code: "P", icone: "✓", label: "Présence — payé 100%" },
  { code: "O", icone: "☕", label: "Repos — payé 100%" },
  { code: "M", icone: "✚", label: "Maladie — payé 2/3, 100 % si justifiée (certificat)" },
  { code: "A", icone: "📄", label: "Absence justifiée — payé 100%" },
  { code: "N", icone: "✕", label: "Absence non justifiée — non payé" },
  { code: "C", icone: "🏖", label: "Congé payé — 100%" },
  { code: "F", icone: "★", label: "Jour férié — payé 100%" },
  { code: "S", icone: "∅", label: "Congé sans solde — non payé" },
];

export default async function PresencesPage({ searchParams }: { searchParams: Promise<{ vue?: string; sem?: string; emp?: string; mois?: string; annee?: string }> }) {
  const user = await exigerPageRH();
  const sp = await searchParams;

  // Mois affiché : le mois RH courant sans `?mois=&annee=` (comme avant) ; un mois PASSÉ se consulte en
  // LECTURE SEULE (aucun geste d'écriture, et le serveur refuse — lib/presences-mois-serveur.ts) ; un mois
  // à venir ou illisible est refusé, jamais remplacé en silence par le mois courant.
  const courant = await lirePeriodeCouranteRH();
  const resolu = resoudreMoisPresences(sp, courant);
  if (!resolu.ok) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-semibold sm:text-2xl">Présences &amp; heures</h1>
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{resolu.message}</p>
        <Link href="/presences" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Revenir au mois en cours</Link>
      </div>
    );
  }
  const { mois, annee } = resolu.periode;
  const passe = resolu.passe;
  const peutModifier = !passe && (user.role === "ADMIN" || user.role === "MANAGER");
  const peutEffacer = !passe && peutSupprimer(user); // vider une présence saisie = suppression → Direction

  const parametres = await chargerParametresPaie();

  const nbJours = new Date(annee, mois, 0).getDate();
  const days = Array.from({ length: nbJours }, (_, i) => i + 1);
  const isoDates = days.map(
    (d) => `${annee}-${String(mois).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  );
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const nbSemaines = numeroSemaineDuMois(new Date(Date.UTC(annee, mois - 1, nbJours)));

  // Les congés approuvés se répercutent TOUJOURS sur la grille (rattrapage des congés validés
  // avant la synchro). Idempotent ; ne touche jamais un code existant ni un mois à paie validée.
  // Mois PASSÉ (lecture seule) : RIEN n'est écrit au chargement — pas de rattrapage.
  if (!passe) await rattraperCodesConges();

  // Salariés SORTIS dans le mois (fin de contrat) : gardés pour leurs jours actifs (audit RH 2026-10-10).
  const inactifsGardes = await inactifsDeLaPeriode(prisma, debutMois, finMois);
  const [employees, attendances, entries, joursFeriesDuMois] = await Promise.all([
    prisma.employee.findMany({ where: { OR: [{ actif: true }, { id: { in: inactifsGardes } }] }, orderBy: { nom: "asc" } }),
    prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
  ]);

  // Horaire du jour par case : pointage RÉEL > horaire par défaut (créneau de travail planifié >
  // modèle hebdo) — la MÊME fonction que les heures pré-remplies d'un P (lib/horaire-par-defaut).
  const shiftMap: Record<string, InfoShift> = await chargerHorairesDuMois(prisma, annee, mois, employees.map((e) => e.id));

  const joursFeries = new Set(
    joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10))
  );

  const attendanceMap: Record<string, string> = {};
  // Jours M justifiés (certificat) : payés 100 % au lieu de 2/3 (décision Direction 2026-10-12).
  const maladieJustifieeMap: Record<string, boolean> = {};
  for (const a of attendances) {
    attendanceMap[`${a.employeeId}_${new Date(a.date).getUTCDate()}`] = a.code;
    if (a.code === "M" && a.maladieJustifiee) maladieJustifieeMap[`${a.employeeId}_${new Date(a.date).getUTCDate()}`] = true;
  }
  const hoursMap: Record<string, number> = {};
  const joursParEmploye: Record<string, { date: Date; heuresTravaillees: number }[]> = {};
  for (const o of entries) {
    const h = Number(o.heuresTravaillees);
    hoursMap[`${o.employeeId}_${new Date(o.date).getUTCDate()}`] = h;
    (joursParEmploye[o.employeeId] ??= []).push({ date: new Date(o.date), heuresTravaillees: h });
  }

  // Détail hebdomadaire (HS par semaine) — calculé côté serveur pour le tableau replié.
  // « HS valorisées » : le MONTANT de la paie (même chemin que le lot : référence du mois puis moteur),
  // plus aucun taux recalculé ici (salaire ÷ 26 ÷ heures/jour divergeait du bulletin).
  // Mois PASSÉ : le montant FIGÉ du bulletin de ce mois-là, jamais un recalcul aux paramètres d'aujourd'hui.
  const [hsPaie, sorties, avantMois, premierMois] = await Promise.all([
    passe ? hsValoriseesFigees(mois, annee, employees) : hsValoriseesPaie(mois, annee, employees, parametres),
    datesDeSortie(prisma, employees.filter((e) => !e.actif).map((e) => e.id)),
    // Semaine à cheval sur le mois précédent : ses heures placent le seuil des HS (même règle que la paie).
    chargerHeuresAvantMois(annee, mois),
    premierMoisAvecDonnees(),
  ]);
  for (const f of avantMois.feriesIso) joursFeries.add(f);
  const semainesParEmploye: Record<string, DetailSemaineHS[]> = {};
  const toRow = (e: (typeof employees)[number]): EmployeeRow => ({
    id: e.id,
    matricule: e.matricule,
    nom: e.nom,
    photoUrl: e.photoUrl,
    heuresParJour: Number(e.heuresParJour),
    heuresHebdo: Number(e.heuresHebdomadaires),
    hsValoriseePaie: hsPaie.get(e.id)?.montant ?? null,
    heuresAvantMois: (avantMois.parEmploye[e.id] ?? []).map((j) => ({ date: j.date.toISOString().slice(0, 10), heures: j.heuresTravaillees })),
    sortieLe: sorties.get(e.id) ?? null,
  });
  const rows = employees.map(toRow);
  for (const r of rows) {
    semainesParEmploye[r.id] = calculerHeuresSupp({
      jours: joursParEmploye[r.id] ?? [],
      joursAvantMois: avantMois.parEmploye[r.id] ?? [],
      heuresParJourContrat: r.heuresParJour,
      heuresHebdoContrat: r.heuresHebdo,
      salaireHoraire: hsPaie.get(r.id)?.tauxHoraire ?? 0, // le tableau hebdomadaire ne montre que des heures
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

  // Vue ouverte : Semaine par défaut, sur la semaine d'aujourd'hui (jour civil de Kinshasa) si elle
  // fait partie de la période. `?vue=mois`, `?sem=AAAA-MM-JJ` (un jour de la semaine) et `?emp=` rouvrent
  // la vue qu'on a quittée (la page recopie son état dans l'adresse).
  const semaines = semainesDuMois(annee, mois, nbJours);
  const semaineAujourdhui = semaineParDefaut(semaines, jourCourantKinshasaISO());
  const semDemandee = sp.sem ? semaines.findIndex((x) => sp.sem! >= x.isos[0] && sp.sem! <= x.isos[6]) : -1;
  const vueInitiale: VuePresences = sp.vue === "mois" || sp.vue === "employe" ? sp.vue : "semaine";
  const pourBarre = [
    ...brigade.map((r) => ({ id: r.id, nom: r.nom, photoUrl: r.photoUrl, groupe: "Brigade" })),
    ...backoffice.map((r) => ({ id: r.id, nom: r.nom, photoUrl: r.photoUrl, groupe: "Back-office" })),
  ];
  const employeInitial = pourBarre.find((e) => e.id === sp.emp)?.id ?? (vueInitiale === "employe" ? pourBarre[0]?.id ?? null : null);
  const semaineInitiale = semDemandee >= 0 ? semDemandee : semaineAujourdhui;
  const { prec, suiv } = bornesNavigation(resolu.periode, courant, premierMois);
  const qMois = requeteMois(resolu.periode, courant);

  return (
    <PresencesVueProvider
      vueInitiale={vueInitiale}
      semaineInitiale={semaineInitiale}
      employeInitial={employeInitial}
      semaines={semaines}
    >
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Présences &amp; heures</h1>
          <p className="text-sm capitalize text-muted-foreground">{periode}</p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {!passe && (
              <>
                Chaque case porte le <b>code du jour</b> (couleur) et les <b>heures travaillées</b>.
                Cliquez une case pour ouvrir le menu (code + heures), ou tapez directement une lettre
                (P, O, M, A, N, C, F, S) — Suppr efface, flèches pour naviguer. Cliquez un nom pour voir
                tout son mois.{" "}
              </>
            )}
            Les 6 premières heures supp. de la semaine sont majorées à 30%, le reste à
            60% ; dimanche et fériés, toutes les heures sont payées double.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <TelechargerLien
            href={qMois ? `/presences/export?${qMois}` : "/presences/export"}
            className="whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
            title="Un seul classeur : Présences, Heures par jour, Détail hebdomadaire"
          >
            Exporter Excel
          </TelechargerLien>
          <NavigationMoisPresences
            courant={courant}
            prec={prec}
            suiv={suiv}
            passe={passe}
            semaines={semaines}
            semaineInitiale={semaineInitiale}
            semInitiale={sp.sem ?? null}
          />
        </div>
      </div>

      {passe && (
        <p role="status" data-mois-passe="" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Mois passé — lecture seule
        </p>
      )}

      {peutModifier && <ImportPointage />}

      <JourMobileProvider defaultIdx={Math.max(0, isoDates.indexOf(jourCourantKinshasaISO()))}>
          <BarreVuePresences semaines={semaines} semaineAujourdhui={semaineAujourdhui} employes={pourBarre} requeteMois={qMois} />

          <div className="mb-3 flex flex-wrap gap-2">
            {LEGENDE.map((l) => (
              <span key={l.code} className={`rounded-md px-2 py-1 text-xs ${COULEUR_CODE[l.code]}`}>
                <span aria-hidden>{l.icone}</span>{" "}
                <span className="font-semibold">{l.code}</span> = {l.label}
              </span>
            ))}
          </div>
          <details className="mb-5 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Comment lire les cases</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-md bg-orange-100 px-2 py-1 text-orange-800">
                Colonne surlignée = dimanche ou jour férié (heures payées double)
              </span>
              <span className="rounded-md border px-2 py-1">
                Sous le code : les horaires du jour (Planning / modèle hebdo) — <b>●</b> = pointage réel
              </span>
              <span className="rounded-md border px-2 py-1">
                <b>p*</b> = pause par défaut {PAUSE_PAR_DEFAUT_MIN} min, non déduite : heures = départ − arrivée (départ pointé sans pause saisie par le salarié)
              </span>
              <span className="rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-800">
                Heures en <b>ambre</b> = au-delà du shift prévu (heures supplémentaires)
              </span>
            </div>
          </details>

          <div className="mb-8">
            <TempsGrid
              titre="Brigade"
              employees={brigade}
              days={days}
              attendanceMap={attendanceMap}
              maladieJustifieeMap={maladieJustifieeMap}
              hoursMap={hoursMap}
              shiftMap={shiftMap}
              peutModifier={peutModifier}
              peutEffacer={peutEffacer}
              isoDates={isoDates}
              joursFeries={joursFeries}
              params={parametres}
            />
          </div>

          <div>
            <TempsGrid
              titre="Back-office"
              employees={backoffice}
              days={days}
              attendanceMap={attendanceMap}
              maladieJustifieeMap={maladieJustifieeMap}
              hoursMap={hoursMap}
              shiftMap={shiftMap}
              peutModifier={peutModifier}
              peutEffacer={peutEffacer}
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
    </PresencesVueProvider>
  );
}
