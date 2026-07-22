import { FilAriane } from "@/components/fil-ariane";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { ancienneteEnMois, calculerCongesAcquis, congeDeductibleDuSolde, resumerPresences, tauxPrimeAnciennete, type CodePresence } from "@/lib/payroll";
import { PrimeForm } from "./prime-form";
import { chargerParametresPaie } from "@/lib/config";
import { DossierEmploye } from "./dossier";
import { Timeline, type EvenementTimeline } from "./timeline";
import { BulletinViewerButton } from "./bulletin-viewer";
import { Avatar } from "@/components/avatar";
import { ajouterPrime, supprimerPrime, supprimerAcompte, demanderAcompte, ajouterFraisMedical, supprimerFraisMedical } from "../../paie/remuneration-actions";
import { calculerBulletinLive } from "@/lib/bulletin-live";
import { ApercuBulletinCard } from "./apercu-bulletin";
import { AbsencesCard, HeuresTravailleesCard } from "./fiche-cards";
import { TelechargerLien } from "@/components/telecharger-lien";
import { lundiDe } from "@/lib/dates-fr";
import { dureeShift, libelleShift } from "../../planning/creneaux";
import { COULEUR_CODE } from "../../presences/attendance-colors";
import { TempsTravail } from "./temps-travail";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { CompteEmployePanel } from "../compte-employe-panel";
import { labelCategoriePro } from "@/lib/categorie-professionnelle";
import { typeSansConges, chargerTauxParTypeConge } from "@/lib/regles-contrats";

function formatMoney(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

// Types de primes courants en RDC (Code du travail + pratique). Les trois primes les plus
// fréquentes (rendement, présence, ancienneté) sont en tête de la liste déroulante.
// À faire valider par un comptable/juriste congolais.
const TYPES_PRIME = [
  "Prime de rendement",
  "Prime de présence",
  "Prime d'ancienneté",
  "Prime d'assiduité",
  "Prime de transport",
  "Prime de logement",
  "Prime de fin d'année (gratification)",
  "Prime de risque",
  "Prime de fonction",
  "Prime de responsabilité",
  "Prime de représentation",
  "Prime de fidélité",
  "Prime de pénibilité",
  "Prime de salissure",
  "Indemnité de vie chère",
  "Gratification exceptionnelle",
];

export default async function FicheEmployePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; erreur?: string }>;
}) {
  const user = await verifySession();
  const peutModifier = user.role === "ADMIN" || user.role === "MANAGER";
  const estAdmin = user.role === "ADMIN";
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "apercu";

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  const [contrats, historique, disciplinaire, evaluations, documents, fichePoste, prets, tachesOnboarding] = await Promise.all([
    prisma.contrat.findMany({ where: { employeeId: id }, orderBy: { dateDebut: "desc" } }),
    prisma.historiqueSalaire.findMany({ where: { employeeId: id }, orderBy: { date: "desc" } }),
    prisma.dossierDisciplinaire.findMany({ where: { employeeId: id }, orderBy: { date: "desc" } }),
    prisma.evaluation.findMany({ where: { employeeId: id }, orderBy: { date: "desc" } }),
    prisma.documentEmploye.findMany({ where: { employeeId: id }, orderBy: { createdAt: "desc" } }),
    // Fiche de poste liée à l'intitulé de poste du salarié (tâches affichées dans l'onglet Contrat).
    // Correspondance insensible à la casse et aux espaces (ex. « Chef de salle » vs « chef de salle »).
    prisma.fichePoste.findFirst({ where: { poste: { equals: employee.poste.trim(), mode: "insensitive" } } }),
    prisma.pretPersonnel.findMany({ where: { employeeId: id }, orderBy: { createdAt: "desc" }, include: { retenues: { orderBy: [{ annee: "asc" }, { mois: "asc" }] } } }),
    prisma.tacheOnboarding.findMany({ where: { employeeId: id }, orderBy: { ordre: "asc" } }),
  ]);
  const pretsView = prets.map((p) => {
    const rembourse = p.retenues.reduce((s, r) => s + Number(r.montantUSD), 0);
    return {
      id: p.id,
      montant: Number(p.montantUSD),
      retenueMensuelle: Number(p.retenueMensuelleUSD),
      motif: p.motif,
      statut: p.statut as string,
      dateAccord: p.dateAccord,
      rembourse,
      solde: Math.max(0, Number(p.montantUSD) - rembourse),
      nbRetenues: p.retenues.length,
    };
  });

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const annee = config?.anneeCourante ?? new Date().getFullYear();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const debutAnnee = new Date(Date.UTC(annee, 0, 1));

  const [attendances, leaveRequests, payrollLines, tauxParType] = await Promise.all([
    prisma.attendance.findMany({
      where: { employeeId: id, date: { gte: debutMois, lte: finMois } },
      orderBy: { date: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { employeeId: id },
      orderBy: { dateDebut: "desc" },
      take: 15,
    }),
    prisma.payrollLine.findMany({
      where: { employeeId: id },
      include: { payrollRun: true },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }],
    }),
    chargerTauxParTypeConge(),
  ]);

  // Semaine en cours (lundi→dimanche, heure de Kinshasa) : planning prévu + réalisé réel.
  const kinshasa = new Date(Date.now() + 3_600_000);
  const lundiSemaine = lundiDe(kinshasa);
  const dimancheSemaine = new Date(lundiSemaine);
  dimancheSemaine.setUTCDate(dimancheSemaine.getUTCDate() + 6);

  const [primes, acomptes, fraisMed, creneauxSemaine, heuresSemaine, presencesSemaine] = await Promise.all([
    prisma.prime.findMany({ where: { employeeId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.acompteSalaire.findMany({ where: { employeeId: id }, orderBy: { dateDemande: "desc" }, take: 30 }),
    prisma.fraisMedical.findMany({ where: { employeeId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.planningCreneau.findMany({
      where: { employeeId: id, date: { gte: lundiSemaine, lte: dimancheSemaine } },
      select: { date: true, shift: { select: { nom: true, heureDebut: true, heureFin: true, dureeHeures: true } } },
    }),
    prisma.overtimeEntry.findMany({
      where: { employeeId: id, date: { gte: lundiSemaine, lte: dimancheSemaine } },
      select: { date: true, heuresTravaillees: true },
    }),
    prisma.attendance.findMany({
      where: { employeeId: id, date: { gte: lundiSemaine, lte: dimancheSemaine } },
      select: { date: true, code: true },
    }),
  ]);

  // Les 7 jours de la semaine : shift planifié (Planning) vs heures réellement travaillées
  // (Présences & heures) — le « réel » vient des saisies/pointages, pas d'un modèle théorique.
  const isoDe = (d: Date) => d.toISOString().slice(0, 10);
  const creneauParJour = new Map(creneauxSemaine.map((c) => [isoDe(new Date(c.date)), c.shift]));
  const heuresParJour = new Map(heuresSemaine.map((h) => [isoDe(new Date(h.date)), Number(h.heuresTravaillees)]));
  const codeParJour = new Map(presencesSemaine.map((p) => [isoDe(new Date(p.date)), p.code]));
  const isoAujourdHui = isoDe(new Date(Date.UTC(kinshasa.getUTCFullYear(), kinshasa.getUTCMonth(), kinshasa.getUTCDate())));
  const joursSemaine = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundiSemaine);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = isoDe(d);
    const shift = creneauParJour.get(iso);
    return {
      iso,
      estAujourdHui: iso === isoAujourdHui,
      label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", timeZone: "UTC" }),
      prevu: shift ? libelleShift(shift.nom, shift.heureDebut, shift.heureFin) : null,
      prevuHeures: shift
        ? dureeShift({ heureDebut: shift.heureDebut, heureFin: shift.heureFin, dureeHeures: shift.dureeHeures != null ? Number(shift.dureeHeures) : null })
        : 0,
      realise: heuresParJour.get(iso) ?? null,
      code: codeParJour.get(iso) ?? null,
    };
  });
  const totalPrevuSemaine = Math.round(joursSemaine.reduce((a, j) => a + j.prevuHeures, 0) * 100) / 100;
  const totalRealiseSemaine = Math.round(joursSemaine.reduce((a, j) => a + (j.realise ?? 0), 0) * 100) / 100;
  const labelSemaine = `${lundiSemaine.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })} → ${dimancheSemaine.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" })}`;
  const fraisMedMoisCourant = fraisMed.filter((f) => f.mois === mois && f.annee === annee);
  const finContrats =
    tab === "fin"
      ? await prisma.finContrat.findMany({ where: { employeeId: id }, orderBy: { createdAt: "desc" } })
      : [];
  // Jours habituellement travaillés (modèle hebdo) — pastilles L→D de la carte « Conditions actuelles ».
  const joursModele =
    tab === "contrats"
      ? [...new Set((await prisma.planningModele.findMany({ where: { employeeId: id }, select: { jour: true } })).map((m) => m.jour))]
      : [];

  // Espace salarié : gestion du compte (Direction, feature active) — affiché dans l'onglet Aperçu.
  const espaceActif = tab === "apercu" && estAdmin ? await espaceEmployeActif() : false;
  const compteSalarie = espaceActif
    ? await prisma.user.findUnique({ where: { employeeId: id }, select: { role: true, actif: true, accesStock: true } })
    : null;

  // Onglet « Temps de travail » : planning (2 semaines) + heures réelles (8 dernières semaines).
  const lundiCourantIso = isoDe(lundiSemaine);
  let donneesTemps: { creneaux: { iso: string; nom: string; heures: number }[]; heures: { iso: string; h: number }[]; codes: { iso: string; code: string }[] } | null = null;
  if (tab === "temps") {
    const debutRapport = new Date(lundiSemaine);
    debutRapport.setUTCDate(debutRapport.getUTCDate() - 7 * 7); // 7 semaines avant la courante
    const finPlanning = new Date(lundiSemaine);
    finPlanning.setUTCDate(finPlanning.getUTCDate() + 13); // dimanche de la semaine suivante
    const [creneauxTemps, heuresTemps, codesTemps] = await Promise.all([
      prisma.planningCreneau.findMany({
        where: { employeeId: id, date: { gte: lundiSemaine, lte: finPlanning } },
        select: { date: true, shift: { select: { nom: true, heureDebut: true, heureFin: true, dureeHeures: true } } },
      }),
      prisma.overtimeEntry.findMany({
        where: { employeeId: id, date: { gte: debutRapport, lte: dimancheSemaine } },
        select: { date: true, heuresTravaillees: true },
      }),
      prisma.attendance.findMany({
        where: { employeeId: id, date: { gte: debutRapport, lte: dimancheSemaine } },
        select: { date: true, code: true },
      }),
    ]);
    donneesTemps = {
      creneaux: creneauxTemps.map((c) => ({
        iso: isoDe(new Date(c.date)),
        nom: c.shift.nom,
        heures: dureeShift({ heureDebut: c.shift.heureDebut, heureFin: c.shift.heureFin, dureeHeures: c.shift.dureeHeures != null ? Number(c.shift.dureeHeures) : null }),
      })),
      heures: heuresTemps.map((h) => ({ iso: isoDe(new Date(h.date)), h: Number(h.heuresTravaillees) })),
      codes: codesTemps.map((c) => ({ iso: isoDe(new Date(c.date)), code: c.code })),
    };
  }
  // Paramètres légaux de départ (préavis, indemnité) — configurables dans Paramètres (À VALIDER).
  const paramsDepart =
    tab === "fin"
      ? await prisma.parametreLegal.findMany({
          where: {
            cle: { in: ["preavis_jours_demission", "preavis_jours_licenciement", "indemnite_licenciement_jours_par_an"] },
          },
          select: { cle: true, valeur: true },
        })
      : [];
  const valParam = (cle: string) => {
    const p = paramsDepart.find((x) => x.cle === cle);
    return p?.valeur != null ? Number(p.valeur) : null;
  };
  const primesMoisCourant = primes.filter((p) => p.mois === mois && p.annee === annee);
  // Le bulletin live (plusieurs requêtes + calcul) n'est utile que dans l'onglet Aperçu.
  const apercuBulletin = tab === "apercu" ? await calculerBulletinLive(id, mois, annee) : null;
  const periodeLabel = new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const resumePresences = resumerPresences(attendances.map((a) => a.code as CodePresence));

  const parametres = await chargerParametresPaie();
  // Heures/mois = heures/semaine × 52/12 (précis) — NE suppose PAS un travail tous les jours.
  const heuresMoisContrat =
    (Number(employee.heuresHebdomadaires) || Number(employee.heuresParJour) * 6) * 52 / 12;
  const salaireHoraire = heuresMoisContrat > 0 ? Number(employee.salaireMensuel) / heuresMoisContrat : 0;
  const salaireJournalier = salaireHoraire * Number(employee.heuresParJour); // paie d'un jour travaillé

  // Transport du mois calculé comme en paie : brigade = tarif journalier × jours de présence P ;
  // backoffice = forfait mensuel fixe. (B3)
  const joursPresenceP = attendances.filter((a) => a.code === "P").length;
  const transportMoisUSD =
    employee.categorie === "BRIGADE"
      ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
      : Number(employee.transportMoisUSD);
  const transportMoisCDF = transportMoisUSD * parametres.tauxChangeCDF;

  const anciennete = ancienneteEnMois(new Date(employee.dateEmbauche), new Date(annee, mois - 1, 1));
  const congesAcquis = typeSansConges(employee.contrat) ? 0 : calculerCongesAcquis(anciennete, parametres.droitsCongesAnnuel);
  const congesPrisAnnee = leaveRequests
    .filter(
      (l) =>
        l.statut === "APPROUVE" &&
        new Date(l.dateDebut) >= debutAnnee &&
        congeDeductibleDuSolde(l.type, tauxParType.get(l.type))
    )
    .reduce((acc, l) => acc + Number(l.nbJours), 0);
  const soldeConges = Math.round((congesAcquis - congesPrisAnnee) * 10) / 10;

  // Notifications de la fiche : échéances contrat / période d'essai / documents, congé en attente.
  const notifications: string[] = [];
  const maintenant = new Date();
  const dans30j = new Date(maintenant.getTime() + 30 * 86400000);
  for (const c of contrats) {
    if (c.dateFin && new Date(c.dateFin) >= maintenant && new Date(c.dateFin) <= dans30j) {
      notifications.push(`Contrat ${c.type} expire le ${new Date(c.dateFin).toLocaleDateString("fr-FR")}`);
    }
    if (
      c.finPeriodeEssai &&
      new Date(c.finPeriodeEssai) >= maintenant &&
      new Date(c.finPeriodeEssai) <= dans30j
    ) {
      notifications.push(
        `Fin de période d'essai le ${new Date(c.finPeriodeEssai).toLocaleDateString("fr-FR")}`
      );
    }
  }
  for (const doc of documents) {
    if (doc.dateExpiration && new Date(doc.dateExpiration) <= dans30j) {
      notifications.push(
        `Document « ${doc.nom} » expire le ${new Date(doc.dateExpiration).toLocaleDateString("fr-FR")}`
      );
    }
  }
  const congesEnAttente = leaveRequests.filter((l) => l.statut === "EN_ATTENTE").length;
  if (congesEnAttente > 0) {
    notifications.push(`${congesEnAttente} demande(s) de congé en attente`);
  }

  // Chronologie (G) : tous les événements datés de l'employé, du plus récent au plus ancien.
  const evenements: EvenementTimeline[] = [
    {
      date: new Date(employee.dateEmbauche),
      icone: "🎉",
      titre: "Embauche",
      detail: `${employee.poste} · ${employee.categorie}`,
    },
    ...historique.map((h) => ({
      date: new Date(h.date),
      icone: "💰",
      titre: h.motif || "Changement de salaire",
      detail: `${h.ancienSalaire ? formatMoney(Number(h.ancienSalaire)) + " → " : ""}${formatMoney(Number(h.nouveauSalaire))}${h.nouveauPoste ? " · " + h.nouveauPoste : ""}`,
    })),
    ...contrats.map((c) => ({
      date: new Date(c.dateDebut),
      icone: "📄",
      titre: `Contrat ${c.type}`,
      detail: `${c.poste} · ${formatMoney(Number(c.salaireMensuel))}${c.dateFin ? " · échéance " + new Date(c.dateFin).toLocaleDateString("fr-FR") : ""}`,
    })),
    ...disciplinaire.map((d) => ({
      date: new Date(d.date),
      icone: "⚠️",
      titre: `Sanction — ${d.type}`,
      detail: d.motif,
    })),
    ...evaluations.map((e) => ({
      date: new Date(e.date),
      icone: "⭐",
      titre: "Évaluation",
      detail: e.note != null ? `${e.note}/100` : e.commentaire ?? undefined,
    })),
    ...leaveRequests.map((l) => ({
      date: new Date(l.dateDebut),
      icone: "🏖",
      titre: `Congé ${l.type}`,
      detail: `${l.statut.replace("_", " ").toLowerCase()} · ${Number(l.nbJours)} j`,
    })),
    ...payrollLines.map((l) => ({
      date: new Date(l.payrollRun.annee, l.payrollRun.mois - 1, 28),
      icone: "🧾",
      titre: `Bulletin ${new Date(l.payrollRun.annee, l.payrollRun.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`,
      detail: l.statutPaiement === "PAYE" ? "payé" : l.statutPaiement === "VALIDE" ? "validé" : "pas validé",
    })),
  ];

  return (
    <div className="max-w-5xl">
      {sp.erreur && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}
      {notifications.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-1 font-semibold">Notifications</p>
          <ul className="list-inside list-disc space-y-0.5">
            {notifications.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3"><FilAriane segments={[{ label: "Employés", href: "/employes" }, { label: employee.nom }]} /></div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:mb-6 sm:gap-4 sm:p-5">
        <div className="flex flex-col items-center gap-1">
          {employee.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={employee.photoUrl} alt={employee.nom} className="h-12 w-12 rounded-full object-cover sm:h-16 sm:w-16" />
          ) : (
            <Avatar nom={employee.nom} taille={48} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold sm:text-2xl">{employee.nom}</h1>
          <p className="text-sm text-muted-foreground">
            {employee.matricule} — {employee.poste} · {employee.secteur}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip>{employee.categorie}</Chip>
            {labelCategoriePro(employee.categorieProfessionnelle) && <Chip>{labelCategoriePro(employee.categorieProfessionnelle)}</Chip>}
            <Chip>{employee.contrat}</Chip>
            <Chip>Ancienneté&nbsp;{anciennete} mois</Chip>
            <Chip>{soldeConges} j de congés</Chip>
            <Link
              href={`/employes/${employee.id}?tab=contrats`}
              className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/70"
            >
              📄 {contrats.length} contrat{contrats.length > 1 ? "s" : ""}
            </Link>
            <Link
              href={`/employes/${employee.id}?tab=dossier`}
              className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/70"
            >
              📁 {documents.length} document{documents.length > 1 ? "s" : ""}
            </Link>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <TelechargerLien
            href={`/employes/${employee.id}/fiche`}
            className="flex-1 rounded-md border px-3 py-1.5 text-center text-sm font-medium hover:bg-accent sm:flex-none sm:px-4 sm:py-2"
          >
            Exporter (PDF)
          </TelechargerLien>
          <Link
            href={`/employes/${employee.id}/modifier`}
            className="flex-1 rounded-md bg-primary px-3 py-1.5 text-center text-sm font-medium text-primary-foreground sm:flex-none sm:px-4 sm:py-2"
          >
            Modifier
          </Link>
        </div>
      </div>

      {/* Onglets internes de la fiche (façon PayFit) — défilement horizontal sur mobile */}
      <div className="mb-5 flex gap-2 overflow-x-auto border-b">
        {[
          { cle: "apercu", label: "Aperçu" },
          { cle: "temps", label: "Temps de travail" },
          { cle: "conges", label: "Congés & absences" },
          { cle: "paie", label: "Paie" },
          { cle: "contrats", label: "Contrats" },
          { cle: "fin", label: "Fin de contrat" },
          { cle: "dossier", label: "Dossier" },
        ].map((o) => (
          <Link
            key={o.cle}
            href={`/employes/${employee.id}?tab=${o.cle}`}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm ${
              tab === o.cle
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </Link>
        ))}
      </div>

      {tab === "apercu" && (
        <>
      {espaceActif && (
        <div className="mb-5">
          <CompteEmployePanel
            employeeId={employee.id}
            aCompte={compteSalarie?.role === "EMPLOYE"}
            compteActif={compteSalarie?.actif ?? false}
            accesStock={compteSalarie?.accesStock ?? false}
          />
        </div>
      )}
      {tab === "apercu" && !apercuBulletin && employee.contrat === "INTERIM" && (
        <div className="mb-5 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Employé intérimaire : salarié de l&apos;agence d&apos;intérim, payé par elle — aucun bulletin n&apos;est généré ici.
        </div>
      )}
      {apercuBulletin && (
        <HeuresTravailleesCard
          periode={periodeLabel}
          heuresTravaillees={apercuBulletin.heuresTravaillees}
          heuresContractuelles={Math.round(heuresMoisContrat)}
          heuresSupp={apercuBulletin.hs30 + apercuBulletin.hs60 + apercuBulletin.hs100}
        />
      )}
      {apercuBulletin && <ApercuBulletinCard apercu={apercuBulletin} periode={periodeLabel} />}

      {/* Informations générales */}
      <Section title="Informations générales">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
          <Info label="Catégorie" value={employee.categorie} />
          <Info label="Type" value={employee.type} />
          <Info label="Contrat" value={employee.contrat} />
          <Info label="Sexe" value={employee.sexe} />
          <Info label="État civil" value={employee.etatCivil} />
          <Info label="Enfants" value={String(employee.enfants)} />
          <Info
            label="Date d'embauche"
            value={new Date(employee.dateEmbauche).toLocaleDateString("fr-FR")}
          />
          <Info label="Ancienneté" value={`${anciennete} mois`} />
          <Info label="Seuil heures supp. (h/jour)" value={`${String(employee.heuresParJour)} h`} />
          <Info label="Heures / semaine" value={`${String(employee.heuresHebdomadaires)} h`} />
          <Info label="Heures / mois (contractuelles)" value={`${Math.round(heuresMoisContrat * 10) / 10} h`} />
        </dl>
      </Section>

      {/* Semaine en cours : planning prévu (Planning) vs heures réellement travaillées (Présences & heures). */}
      <Section title={`Cette semaine — planning et heures réelles (${labelSemaine})`}>
        <p className="mb-3 text-xs text-muted-foreground">
          <span className="font-medium">Planifié</span> = le planning de la semaine ·{" "}
          <span className="font-medium">Réalisé</span> = les heures réellement saisies/pointées.
          L&apos;horaire type se règle dans <Link href="/planning?vue=modele" className="text-primary underline">Planning → Modèle hebdo</Link>.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[30rem] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th>Jour</th><th>Planifié</th><th className="text-right">Prévu</th><th className="text-right">Réalisé</th><th>Présence</th>
              </tr>
            </thead>
            <tbody>
              {joursSemaine.map((j) => (
                <tr key={j.iso} className={`border-t ${j.estAujourdHui ? "bg-primary/5 font-medium" : ""}`}>
                  <td className="px-3 py-1.5 capitalize">{j.label}{j.estAujourdHui ? " ·" : ""}</td>
                  <td className="px-3 py-1.5">{j.prevu ?? <span className="text-muted-foreground">Repos</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{j.prevuHeures > 0 ? `${j.prevuHeures} h` : "—"}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {j.realise !== null && j.realise > 0 ? `${j.realise.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h` : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    {j.code ? (
                      <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${COULEUR_CODE[j.code as CodePresence] ?? ""}`}>{j.code}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-medium">
                <td className="px-3 py-1.5" colSpan={2}>Total semaine</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{totalPrevuSemaine > 0 ? `${totalPrevuSemaine} h` : "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{totalRealiseSemaine > 0 ? `${totalRealiseSemaine} h` : "—"}</td>
                <td className="px-3 py-1.5" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 flex gap-4 text-xs">
          <Link href="/planning" className="text-primary underline">Voir le planning →</Link>
          <Link href="/presences" className="text-primary underline">Voir présences &amp; heures →</Link>
        </p>
      </Section>

      {/* Détails salariaux */}
      <Section title="Détails salariaux">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
          <Info label="Salaire mensuel" value={formatMoney(Number(employee.salaireMensuel))} />
          <Info label="Salaire journalier" value={formatMoney(salaireJournalier)} />
          <Info label="Salaire horaire" value={formatMoney(salaireHoraire)} />
          <Info
            label="Transport / jour"
            value={`${Number(employee.transportJourCDF).toLocaleString("fr-FR")} CDF`}
          />
          <Info
            label={
              employee.categorie === "BRIGADE"
                ? `Transport / mois (${joursPresenceP} j P × journalier)`
                : "Transport / mois (forfait)"
            }
            value={`${formatMoney(transportMoisUSD)} · ${Math.round(transportMoisCDF).toLocaleString("fr-FR")} CDF`}
          />
          <Info label="CNSS" value={formatMoney(Number(employee.cnssMontant))} />
          <Info
            label="Frais médicaux (mois en cours)"
            value={formatMoney(Number(employee.fraisMedicauxMoisCourant))}
          />
        </dl>
      </Section>

      {/* Coordonnées & informations de paiement */}
      <Section title="Coordonnées & paiement">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
          <Info label="Téléphone" value={employee.telephone || "—"} />
          <Info label="E-mail" value={employee.email || "—"} />
          <Info label="Adresse" value={employee.adresse || "—"} />
          <Info
            label="Date d'anniversaire"
            value={employee.dateNaissance ? new Date(employee.dateNaissance).toLocaleDateString("fr-FR") : "—"}
          />
          <Info label="Banque" value={employee.banque || "—"} />
          <Info label="Compte bancaire" value={employee.compteBancaire || "—"} />
          <Info label="Mobile Money" value={employee.mobileMoney || "—"} />
        </dl>
      </Section>

      {/* Présences du mois */}
      <Section
        title={`Présences — ${new Date(annee, mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`}
        action={
          <Link href="/presences" className="text-sm text-primary underline">
            Saisir les présences
          </Link>
        }
      >
        <div className="grid grid-cols-4 gap-4 text-sm md:grid-cols-4">
          <Stat label="Payé 100%" value={resumePresences.payes100} />
          <Stat label="Payé 2/3 (maladie)" value={resumePresences.payes2_3} />
          <Stat label="Non payé" value={resumePresences.nonPayes} />
          <Stat label="Total présences" value={resumePresences.totalPresence} />
        </div>
      </Section>

      <Section title="Chronologie">
        <Timeline evenements={evenements} />
      </Section>
        </>
      )}

      {tab === "conges" && (
      <Section
        title="Congés et absences"
        action={
          <Link href="/conges" className="text-sm text-primary underline">
            Nouvelle demande
          </Link>
        }
      >
        <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
          <Stat label="Congés acquis (année)" value={congesAcquis} />
          <Stat label="Congés pris (année)" value={congesPrisAnnee} />
          <Stat label="Solde" value={soldeConges} />
        </div>

        <AbsencesCard
          absences={leaveRequests.map((l) => ({
            id: l.id,
            type: l.type,
            dateDebut: new Date(l.dateDebut),
            dateFin: new Date(l.dateFin),
            nbJours: Number(l.nbJours),
            statut: l.statut,
          }))}
        />
      </Section>
      )}

      {tab === "paie" && (
      <>
      <Section title="Historique de paie">
        <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Période</th>
              <th className="px-3 py-2 text-right">Salaire net $</th>
              <th className="px-3 py-2 text-right">Salaire net CDF</th>
              <th className="px-3 py-2">Paiement</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {payrollLines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2">
                  {new Date(l.payrollRun.annee, l.payrollRun.mois - 1).toLocaleDateString("fr-FR", {
                    month: "long",
                    year: "numeric",
                  })}
                </td>
                <td className="px-3 py-2 text-right">{formatMoney(Number(l.salNetUSD))}</td>
                <td className="px-3 py-2 text-right">
                  {Number(l.salNetCDF).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} CDF
                </td>
                <td className="px-3 py-2">
                  <PaiementBadge statut={l.statutPaiement} />
                </td>
                <td className="px-3 py-2 text-right">
                  <BulletinViewerButton
                    payrollLineId={l.id}
                    nom={`${employee.nom} — ${new Date(l.payrollRun.annee, l.payrollRun.mois - 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`}
                  />
                  {" · "}
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=USD&dl=1`} className="text-primary underline">
                    $
                  </TelechargerLien>
                  {" · "}
                  <TelechargerLien href={`/paie/bulletin/${l.id}?devise=CDF&dl=1`} className="text-primary underline">
                    CDF
                  </TelechargerLien>
                </td>
              </tr>
            ))}
            {payrollLines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                  Aucune paie calculée pour cet employé pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Section>

      <Section title="Primes & acompte de la période en cours">
        {peutModifier && (
          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <PrimeForm
              action={ajouterPrime.bind(null, employee.id)}
              types={TYPES_PRIME}
              salaireBase={Number(employee.salaireMensuel)}
              tauxAnciennete={tauxPrimeAnciennete(anciennete / 12)}
            />
            <form action={demanderAcompte.bind(null, employee.id)} className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">Demander un acompte</p>
              <div className="flex flex-wrap items-end gap-2">
                <input name="montantUSD" type="number" step="0.01" min="0" placeholder="Montant $" required className="w-28 rounded border border-input bg-background px-2 py-1 text-sm" />
                <input name="motif" placeholder="Motif (optionnel)" className="rounded border border-input bg-background px-2 py-1 text-sm" />
                <button type="submit" className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent">Demander</button>
              </div>
            </form>
            <form action={ajouterFraisMedical.bind(null, employee.id)} className="rounded-lg border p-3 md:col-span-2">
              <p className="mb-2 text-sm font-medium">Ajouter un frais médical (avec certificat)</p>
              <div className="flex flex-wrap items-end gap-2">
                <input name="montantUSD" type="number" step="0.01" min="0" placeholder="Montant $" required className="w-28 rounded border border-input bg-background px-2 py-1 text-sm" />
                <input name="motif" placeholder="Motif (optionnel)" className="rounded border border-input bg-background px-2 py-1 text-sm" />
                <input name="certificat" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="text-xs" />
                <button type="submit" className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Ajouter</button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Remboursé sur le bulletin de la période (non imposable). PDF ou image.</p>
            </form>
          </div>
        )}

        {fraisMedMoisCourant.length > 0 && (
          <>
            <p className="mb-2 mt-2 text-xs font-semibold uppercase text-muted-foreground">Frais médicaux (mois en cours)</p>
            <div className="mb-4 flex flex-wrap gap-2">
              {fraisMedMoisCourant.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs text-sky-800">
                  {formatMoney(Number(f.montantUSD))}{f.motif ? ` · ${f.motif}` : ""}
                  {f.certificatUrl && <a href={f.certificatUrl} target="_blank" className="underline">certificat</a>}
                  {estAdmin && (
                    <form action={supprimerFraisMedical.bind(null, f.id)} className="inline">
                      <button className="text-sky-900/70 hover:text-sky-900" title="Supprimer">✕</button>
                    </form>
                  )}
                </span>
              ))}
            </div>
          </>
        )}

        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Primes (mois en cours)</p>
        {primesMoisCourant.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">Aucune prime ce mois.</p>
        ) : (
          <div className="mb-4 flex flex-wrap gap-2">
            {primesMoisCourant.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800">
                {p.nom} : {formatMoney(Number(p.montantUSD))}
                {estAdmin && (
                  <form action={supprimerPrime.bind(null, p.id)} className="inline">
                    <button className="text-emerald-900/70 hover:text-emerald-900" title="Supprimer">✕</button>
                  </form>
                )}
              </span>
            ))}
          </div>
        )}

        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Historique des acomptes</p>
        <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Période</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2">Motif</th>
              <th className="px-3 py-2">Statut</th>
              {estAdmin && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {acomptes.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-3 py-2">{a.mois}/{a.annee}</td>
                <td className="px-3 py-2 text-right">{formatMoney(Number(a.montantUSD))}</td>
                <td className="px-3 py-2">{a.motif ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.statut === "APPROUVE" ? "bg-green-100 text-green-800" : a.statut === "REFUSE" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                    {a.statut === "APPROUVE" ? "Approuvé" : a.statut === "REFUSE" ? "Refusé" : "En attente"}
                  </span>
                </td>
                {estAdmin && (
                  <td className="px-3 py-2 text-right">
                    <form action={supprimerAcompte.bind(null, a.id)} className="inline">
                      <button className="text-muted-foreground hover:text-destructive" title="Supprimer l'acompte">✕</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {acomptes.length === 0 && (
              <tr><td colSpan={estAdmin ? 5 : 4} className="px-3 py-4 text-center text-muted-foreground">Aucun acompte.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </Section>
      </>
      )}

      {tab === "temps" && donneesTemps && (
        <TempsTravail
          lundiCourantIso={lundiCourantIso}
          creneaux={donneesTemps.creneaux}
          heures={donneesTemps.heures}
          codes={donneesTemps.codes}
        />
      )}

      {(tab === "contrats" || tab === "fin" || tab === "dossier") && (
      <DossierEmploye
        vue={tab}
        employeeId={employee.id}
        poste={employee.poste}
        fichePosteExiste={Boolean(fichePoste)}
        fichePosteDescriptionPoste={fichePoste?.descriptionPoste ?? null}
        fichePosteDescription={fichePoste?.description ?? null}
        fichePosteFichierUrl={fichePoste?.fichierUrl ?? null}
        salaireMensuel={Number(employee.salaireMensuel)}
        salaireJournalier={salaireJournalier}
        soldeConges={soldeConges}
        joursPresence={joursPresenceP}
        ancienneteMois={anciennete}
        preavisDemission={valParam("preavis_jours_demission")}
        preavisLicenciement={valParam("preavis_jours_licenciement")}
        indemniteLicenciementJoursParAn={valParam("indemnite_licenciement_jours_par_an")}
        actif={employee.actif}
        joursModele={joursModele}
        contrats={contrats}
        prets={pretsView}
        tachesOnboarding={tachesOnboarding.map((t) => ({ id: t.id, libelle: t.libelle, fait: t.fait, faitLe: t.faitLe }))}
        historique={historique}
        disciplinaire={disciplinaire}
        evaluations={evaluations}
        documents={documents}
        finContrats={finContrats}
        peutModifier={peutModifier}
        estAdmin={estAdmin}
      />
      )}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold capitalize">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">
      {children}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function PaiementBadge({ statut }: { statut: string }) {
  const styles: Record<string, string> = {
    PAYE: "bg-green-100 text-green-800",
    VALIDE: "bg-blue-100 text-blue-800",
    PAS_VALIDE: "bg-amber-100 text-amber-800",
  };
  const labels: Record<string, string> = {
    PAYE: "Payé",
    VALIDE: "Validé",
    PAS_VALIDE: "Pas validé",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[statut] ?? ""}`}>
      {labels[statut] ?? statut}
    </span>
  );
}
