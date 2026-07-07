"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { tachesBloquantesCloture } from "@/lib/cloture-paie";
import { journaliser } from "@/lib/audit";
import { transitionAutorisee, roleRequisPour } from "@/lib/paie-etats";
import {
  calculerHeuresSupp,
  calculerJoursOuvrables,
  calculerPaieBackoffice,
  calculerPaieBrigade,
  resumerPresences,
  type CodePresence,
} from "@/lib/payroll";
import type { ModePaiement, PaymentStatus } from "@prisma/client";

// États figés : une ligne validée ou payée n'est jamais recalculée / écrasée (bulletin émis).
const STATUTS_FIGES: PaymentStatus[] = ["VALIDE", "PAYE"];
// Conversion PRÉCISE heures/semaine → heures/mois : 52 semaines ÷ 12 mois = 4,3333 (aucune estimation).
const SEMAINES_PAR_MOIS = 52 / 12;

export async function calculerPaieDuMois() {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const parametres = await chargerParametresPaie();
  const mois = config.moisCourant;
  const annee = config.anneeCourante;
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const run = await prisma.payrollRun.upsert({
    where: { mois_annee: { mois, annee } },
    update: { tauxChangeUtilise: config.tauxChangeCDF },
    create: { mois, annee, tauxChangeUtilise: config.tauxChangeCDF },
  });

  // Toutes les données du mois chargées en 4 requêtes (au lieu d'une par employé — perf).
  const [
    employees,
    joursFeriesDuMois,
    attendances,
    overtimeEntries,
    lignesFigees,
    primesDuMois,
    acomptesDuMois,
    congesDuMois,
    fraisMedDuMois,
  ] = await Promise.all([
      prisma.employee.findMany({ where: { actif: true } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      // Lignes déjà validées/payées : on ne les recalcule pas (bulletin émis non écrasable).
      prisma.payrollLine.findMany({
        where: { payrollRunId: run.id, statutPaiement: { in: STATUTS_FIGES } },
        select: { employeeId: true },
      }),
      prisma.prime.findMany({ where: { mois, annee } }),
      prisma.acompteSalaire.findMany({ where: { mois, annee, statut: "APPROUVE" } }),
      // Congés approuvés chevauchant le mois : servent à afficher les jours de congé pris
      // (les congés saisis en demande ne créent pas de code présence « C »).
      prisma.leaveRequest.findMany({
        where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
      }),
      prisma.fraisMedical.findMany({ where: { mois, annee } }),
    ]);

  // Frais médicaux du mois (avec certificat) sommés par employé.
  const fraisMedParEmp = new Map<string, number>();
  for (const f of fraisMedDuMois)
    fraisMedParEmp.set(f.employeeId, (fraisMedParEmp.get(f.employeeId) ?? 0) + Number(f.montantUSD));

  // Jours de congé (ouvrables) réellement posés dans le mois, par employé, depuis les demandes.
  const joursCongeParEmp = new Map<string, number>();
  for (const c of congesDuMois) {
    const debut = new Date(c.dateDebut) < debutMois ? debutMois : new Date(c.dateDebut);
    const fin = new Date(c.dateFin) > finMois ? finMois : new Date(c.dateFin);
    joursCongeParEmp.set(
      c.employeeId,
      (joursCongeParEmp.get(c.employeeId) ?? 0) + calculerJoursOuvrables(debut, fin)
    );
  }

  // Primes (gain) et acomptes approuvés (déduits du net) sommés par employé.
  const primesParEmp = new Map<string, number>();
  for (const p of primesDuMois)
    primesParEmp.set(p.employeeId, (primesParEmp.get(p.employeeId) ?? 0) + Number(p.montantUSD));
  const acomptesParEmp = new Map<string, number>();
  for (const a of acomptesDuMois)
    acomptesParEmp.set(a.employeeId, (acomptesParEmp.get(a.employeeId) ?? 0) + Number(a.montantUSD));

  const joursFeries = new Set(
    joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10))
  );
  const employeeIdsFiges = new Set(lignesFigees.map((l) => l.employeeId));

  // Regroupement en mémoire (évite les requêtes par employé).
  const codesParEmp = new Map<string, CodePresence[]>();
  const codeParJour = new Map<string, Map<string, string>>(); // empId -> "YYYY-MM-DD" -> code
  for (const a of attendances) {
    (codesParEmp.get(a.employeeId) ?? codesParEmp.set(a.employeeId, []).get(a.employeeId)!).push(
      a.code as CodePresence
    );
    const iso = new Date(a.date).toISOString().slice(0, 10);
    (codeParJour.get(a.employeeId) ?? codeParJour.set(a.employeeId, new Map()).get(a.employeeId)!).set(
      iso,
      a.code
    );
  }
  const heuresParEmp = new Map<string, { date: Date; heuresTravaillees: number }[]>();
  const heureParJour = new Map<string, Map<string, number>>(); // empId -> "YYYY-MM-DD" -> heures
  for (const o of overtimeEntries) {
    (heuresParEmp.get(o.employeeId) ?? heuresParEmp.set(o.employeeId, []).get(o.employeeId)!).push({
      date: new Date(o.date),
      heuresTravaillees: Number(o.heuresTravaillees),
    });
    const iso = new Date(o.date).toISOString().slice(0, 10);
    (heureParJour.get(o.employeeId) ?? heureParJour.set(o.employeeId, new Map()).get(o.employeeId)!).set(
      iso,
      Number(o.heuresTravaillees)
    );
  }

  // Option A — paie multi-rôles : taux horaire du rôle de chaque jour (planning), pour un taux
  // horaire EFFECTIF pondéré par les heures. Employés mono-rôle sans taux de shift = inchangés.
  const [creneauxMois, shiftsAvecTaux] = await Promise.all([
    prisma.planningCreneau.findMany({
      where: { date: { gte: debutMois, lte: finMois } },
      select: { employeeId: true, date: true, shiftId: true },
    }),
    prisma.shift.findMany({ select: { id: true, tauxHoraireUSD: true } }),
  ]);
  const tauxParShift = new Map<string, number>();
  for (const s of shiftsAvecTaux) if (s.tauxHoraireUSD != null) tauxParShift.set(s.id, Number(s.tauxHoraireUSD));
  const tauxRoleParJour = new Map<string, Map<string, number>>(); // empId -> iso -> taux du rôle
  for (const c of creneauxMois) {
    const t = tauxParShift.get(c.shiftId);
    if (t == null) continue;
    const iso = new Date(c.date).toISOString().slice(0, 10);
    (tauxRoleParJour.get(c.employeeId) ?? tauxRoleParJour.set(c.employeeId, new Map()).get(c.employeeId)!).set(iso, t);
  }

  const nouvellesLignes = [];
  const employesFraisMedicaux: string[] = [];

  for (const employee of employees) {
    if (employeeIdsFiges.has(employee.id)) continue;

    const codes = codesParEmp.get(employee.id) ?? [];
    const resume = resumerPresences(codes);
    // Heures contractuelles du mois = heures/SEMAINE × 52/12 (PAS heures/jour × jours ouvrables,
    // qui supposerait un travail tous les jours). Ex. Aimée 43 → 186,3 ; Rachel 36 → 156 ; plein 48 → 208.
    const heuresHebdo = Number(employee.heuresHebdomadaires) || Number(employee.heuresParJour) * 6;
    const heuresMoisContrat = heuresHebdo * SEMAINES_PAR_MOIS;
    const tauxDefaut = Number(employee.salaireMensuel) / heuresMoisContrat;
    // Taux effectif = Σ(heures du jour × taux du rôle du jour) ÷ Σ heures ; sinon taux par défaut.
    const rolesEmp = tauxRoleParJour.get(employee.id);
    const heuresEmp = heureParJour.get(employee.id) ?? new Map<string, number>();
    let sommeH = 0;
    let sommeHT = 0;
    for (const [iso, h] of heuresEmp) {
      if (h <= 0) continue;
      sommeH += h;
      sommeHT += h * (rolesEmp?.get(iso) ?? tauxDefaut);
    }
    const salaireHoraire = sommeH > 0 ? sommeHT / sommeH : tauxDefaut;
    const salaireJournalier = salaireHoraire * Number(employee.heuresParJour);
    const fraisMedicauxUSD = Number(employee.fraisMedicauxMoisCourant) + (fraisMedParEmp.get(employee.id) ?? 0);
    if (fraisMedicauxUSD !== 0) employesFraisMedicaux.push(employee.id);

    const hs = calculerHeuresSupp({
      jours: heuresParEmp.get(employee.id) ?? [],
      heuresParJourContrat: Number(employee.heuresParJour),
      heuresHebdoContrat: Number(employee.heuresHebdomadaires),
      // Majorations HS calculées sur le taux PAR DÉFAUT (inchangées) ; seule la base multi-rôles varie.
      salaireHoraire: tauxDefaut,
      joursFeries,
      params: parametres,
    });

    // Jours de congé : max entre codes présence « C » et congés approuvés (demandes), qui ne
    // créent pas de code « C ». Évite le double comptage si les deux sont saisis.
    const joursCongePris = Math.max(
      codes.filter((c) => c === "C").length,
      joursCongeParEmp.get(employee.id) ?? 0
    );
    const indemniteCongesUSD = joursCongePris * salaireJournalier;
    const nombreAbsences = codes.filter((c) => c === "A" || c === "N" || c === "S").length;
    const heuresContractuelles = Math.round(heuresMoisContrat * 100) / 100;

    // Transport (B3) : brigade = tarif journalier (CDF) × jours de présence réelle (code P),
    // converti en USD au taux du mois. Backoffice = forfait mensuel fixe (transportMoisUSD).
    const joursPresenceP = codes.filter((c) => c === "P").length;
    const transportUSD =
      employee.categorie === "BRIGADE"
        ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
        : Number(employee.transportMoisUSD);

    // §8 : un jour avec heures est payé aux heures ; un jour payé SANS heures (repos, absence
    // justifiée, congé, férié non travaillé) est valorisé à la journée. Maladie (M) = 2/3.
    const codesJours = codeParJour.get(employee.id) ?? new Map<string, string>();
    const heuresJours = heureParJour.get(employee.id) ?? new Map<string, number>();
    let joursPayesNonTravailles = 0;
    let joursMaladie = 0;
    for (const [iso, code] of codesJours) {
      if ((heuresJours.get(iso) ?? 0) > 0) continue; // jour travaillé → payé aux heures
      if (code === "O" || code === "A" || code === "C" || code === "F") joursPayesNonTravailles++;
      else if (code === "M") joursMaladie++;
    }

    const primesUSD = primesParEmp.get(employee.id) ?? 0;
    const acompteUSD = acomptesParEmp.get(employee.id) ?? 0;

    const ligne =
      employee.categorie === "BRIGADE"
        ? calculerPaieBrigade(
            {
              salaireJournalier,
              salaireHoraire,
              heuresNormales: hs.heuresTotalesMois - hs.hs30 - hs.hs60 - hs.hs100,
              joursPayesNonTravailles,
              joursPayes2_3: joursMaladie,
              hsValorisee: hs.hsValorisee,
              transportMoisUSD: transportUSD,
              enfants: employee.enfants,
              fraisMedicauxUSD,
              primesUSD,
              acompteUSD,
            },
            parametres
          )
        : calculerPaieBackoffice(
            {
              salaireBaseUSD: Number(employee.salaireMensuel),
              transportUSD: transportUSD,
              enfants: employee.enfants,
              fraisMedicauxUSD,
              primesUSD,
              acompteUSD,
            },
            parametres
          );

    nouvellesLignes.push({
      payrollRunId: run.id,
      employeeId: employee.id,
      joursPayes100: resume.payes100,
      joursPayes2_3: resume.payes2_3,
      joursNonPayes: resume.nonPayes,
      nombreAbsences,
      remuneration100: ligne.remuneration100,
      remuneration2_3: ligne.remuneration2_3,
      hsValorisee: hs.hsValorisee,
      heuresTravaillees: hs.heuresTotalesMois,
      heuresContractuelles,
      heuresSupp30: hs.hs30,
      heuresSupp60: hs.hs60,
      heuresSupp100: hs.hs100,
      joursCongePris,
      indemniteCongesUSD,
      fraisMedicauxUSD,
      transportUSD: transportUSD,
      primesUSD: ligne.primesUSD,
      acompteUSD: ligne.acompteUSD,
      salBrutUSD: ligne.salBrutUSD,
      cnssSalarieUSD: ligne.cnssSalarieUSD,
      netImposableUSD: ligne.netImposableUSD,
      iprCalculeUSD: ligne.iprCalculeUSD,
      allocFamilialeUSD: ligne.allocFamilialeUSD,
      salNetUSD: ligne.salNetUSD,
      salNetCDF: ligne.salNetCDF,
      cnssPatronalUSD: ligne.cnssPatronalUSD,
      inppUSD: ligne.inppUSD,
      onemUSD: ligne.onemUSD,
      coutEmployeurUSD: ligne.coutEmployeurUSD,
      coutEmployeurCDF: ligne.coutEmployeurCDF,
    });
  }

  // Écriture en masse dans une transaction (remplace ~100 requêtes par ~4).
  await prisma.$transaction([
    prisma.payrollLine.deleteMany({
      where: { payrollRunId: run.id, statutPaiement: { notIn: STATUTS_FIGES } },
    }),
    prisma.payrollLine.createMany({ data: nouvellesLignes }),
    prisma.employee.updateMany({
      where: { id: { in: employesFraisMedicaux } },
      data: { fraisMedicauxMoisCourant: 0 },
    }),
    prisma.journalAudit.create({
      data: {
        entite: "PayrollRun",
        entiteId: run.id,
        champ: "calcul",
        nouvelleValeur: `${nouvellesLignes.length} salaire(s) recalculé(s) — ${mois}/${annee}`,
        userId: user.id,
      },
    }),
  ]);

  revalidatePath("/paie");
  revalidatePath("/dashboard");
  revalidatePath("/employes");
}

/**
 * Recalcule la paie du mois courant UNIQUEMENT si elle a déjà été calculée (une PayrollRun existe),
 * afin de répercuter un changement de prime / acompte / frais médical sur les lignes non figées
 * (les lignes VALIDÉES/PAYÉES sont préservées par calculerPaieDuMois). Ne crée jamais de run.
 * À appeler après toute modification qui doit se refléter sur le bulletin en cours.
 */
export async function recalculerPaieSiCalculee() {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  if (!config) return;
  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
  });
  if (run) await calculerPaieDuMois();
}

/**
 * Cœur d'une transition de la machine à états de paie (En attente → Préparé → Validé → Payé,
 * annulation possible). Enregistre la transition, journalise l'audit, fige un snapshot immuable
 * du bulletin au passage en « Validé ». Retourne false si la transition n'est pas autorisée
 * (en lot : on ignore silencieusement les lignes non concernées). NE vérifie pas le rôle ni ne
 * revalide — l'appelant s'en charge (unitaire ou groupé).
 */
async function appliquerTransitionPaie(
  payrollLineId: string,
  versStatut: PaymentStatus,
  opts: { modePaiement?: ModePaiement | null; preuveUrl?: string | null; commentaire?: string | null },
  userId: string
): Promise<boolean> {
  const ligne = await prisma.payrollLine.findUnique({
    where: { id: payrollLineId },
    include: { employee: true, payrollRun: true },
  });
  if (!ligne || !transitionAutorisee(ligne.statutPaiement, versStatut)) return false;

  const deStatut = ligne.statutPaiement;
  const modePaiement = opts.modePaiement ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.payrollLine.update({
      where: { id: payrollLineId },
      data: {
        statutPaiement: versStatut,
        datePaiement: versStatut === "PAYE" ? new Date() : ligne.datePaiement,
        modePaiement: versStatut === "PAYE" ? modePaiement : ligne.modePaiement,
        payeParId: versStatut === "PAYE" ? userId : ligne.payeParId,
      },
    });

    await tx.transitionPaie.create({
      data: {
        payrollLineId,
        deStatut,
        versStatut,
        userId,
        modePaiement: versStatut === "PAYE" ? modePaiement : null,
        preuveUrl: opts.preuveUrl ?? null,
        commentaire: opts.commentaire ?? null,
      },
    });

    // Au passage en « Validé », on fige un snapshot immuable du bulletin (jamais écrasé ensuite).
    if (versStatut === "VALIDE") {
      const dernier = await tx.versionBulletin.findFirst({
        where: { payrollLineId },
        orderBy: { numeroVersion: "desc" },
      });
      await tx.versionBulletin.create({
        data: {
          payrollLineId,
          numeroVersion: (dernier?.numeroVersion ?? 0) + 1,
          snapshot: JSON.parse(JSON.stringify({ ligne, employe: ligne.employee, run: ligne.payrollRun })),
          genreParId: userId,
        },
      });
    }

    await journaliser(tx, {
      entite: "PayrollLine",
      entiteId: payrollLineId,
      champ: "statutPaiement",
      ancienneValeur: deStatut,
      nouvelleValeur: versStatut,
      userId,
    });
  });

  return true;
}

/** Transition d'UNE ligne de paie (depuis un formulaire). */
export async function changerStatutPaie(payrollLineId: string, formData: FormData) {
  const user = await verifySession();
  const versStatut = String(formData.get("versStatut")) as PaymentStatus;
  const modePaiement = (formData.get("modePaiement") as ModePaiement | null) || null;
  const preuveUrl = String(formData.get("preuveUrl") ?? "").trim() || null;
  const commentaire = String(formData.get("commentaire") ?? "").trim() || null;

  requireRole(user, roleRequisPour(versStatut));

  const ok = await appliquerTransitionPaie(
    payrollLineId,
    versStatut,
    { modePaiement, preuveUrl, commentaire },
    user.id
  );
  if (!ok) throw new Error(`Transition non autorisée vers ${versStatut}.`);

  revalidatePath("/paie");
  revalidatePath("/dashboard");
  revalidatePath("/a-valider");
}

/**
 * ACTION GROUPÉE : applique la même transition à plusieurs lignes d'un coup (gain de temps).
 * Les lignes pour lesquelles la transition n'est pas autorisée sont ignorées. Retourne le
 * nombre de lignes effectivement modifiées.
 */
export async function changerStatutEnLot(
  payrollLineIds: string[],
  versStatut: PaymentStatus,
  modePaiement?: ModePaiement | null
): Promise<number> {
  const user = await verifySession();
  requireRole(user, roleRequisPour(versStatut));

  let modifiees = 0;
  for (const id of payrollLineIds) {
    if (await appliquerTransitionPaie(id, versStatut, { modePaiement }, user.id)) modifiees++;
  }

  revalidatePath("/paie");
  revalidatePath("/dashboard");
  revalidatePath("/a-valider");
  return modifiees;
}

/**
 * CLÔTURE GLOBALE (§9) : valide d'un coup tous les bulletins « pas validé » du mois.
 * BLOQUÉE s'il reste des tâches à traiter (acompte non traité, contrat à échéance, période
 * d'essai). Tracée à l'audit. Réservée à l'Admin.
 */
export async function cloturerPaie(): Promise<void> {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });

  const taches = await tachesBloquantesCloture(config.moisCourant, config.anneeCourante);
  if (taches.length > 0) {
    throw new Error(
      `Clôture bloquée : ${taches.length} tâche(s) à traiter avant de valider la paie (voir la bannière).`
    );
  }

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
    include: { lignes: { where: { statutPaiement: "PAS_VALIDE" }, select: { id: true } } },
  });
  if (!run) return;

  for (const l of run.lignes) {
    await appliquerTransitionPaie(l.id, "VALIDE", {}, user.id);
  }
  await prisma.payrollRun.update({ where: { id: run.id }, data: { statut: "VALIDE" } });

  revalidatePath("/paie");
  revalidatePath("/a-valider");
  revalidatePath("/dashboard");
}

/**
 * Réinitialise la paie du mois en cours. Refuse si des salaires sont déjà validés ou payés
 * (bulletins émis non destructibles) — il faut d'abord les annuler explicitement.
 * N'affecte pas l'historique des mois passés.
 */
export async function reinitialiserPaieDuMois() {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
    include: { lignes: { select: { statutPaiement: true } } },
  });
  if (!run) redirect(`/paie?msg=${encodeURIComponent("Aucune paie à réinitialiser pour ce mois.")}`);

  const figees = run.lignes.filter((l) => STATUTS_FIGES.includes(l.statutPaiement)).length;
  if (figees > 0) {
    // Bulletins validés/payés protégés : message clair au lieu de faire planter la page.
    redirect(
      `/paie?erreur=${encodeURIComponent(
        `${figees} bulletin(s) validé(s)/payé(s) ce mois : rouvrez-les d'abord (sous-onglet « Valider les bulletins ») avant de réinitialiser.`
      )}`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.payrollRun.delete({ where: { id: run.id } });
    await journaliser(tx, {
      entite: "PayrollRun",
      entiteId: run.id,
      champ: "suppression",
      ancienneValeur: `${config.moisCourant}/${config.anneeCourante} (${run.lignes.length} lignes)`,
      userId: user.id,
    });
  });

  revalidatePath("/paie");
  revalidatePath("/dashboard");
  revalidatePath("/historique");
  redirect(`/paie?msg=${encodeURIComponent("Paie du mois réinitialisée.")}`);
}
