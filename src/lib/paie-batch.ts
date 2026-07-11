import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import {
  calculerHeuresSupp,
  calculerJoursOuvrables,
  calculerPaieBackoffice,
  calculerPaieBrigade,
  resumerPresences,
  type CodePresence,
} from "@/lib/payroll";
import type { Employee } from "@prisma/client";

// Conversion PRÉCISE heures/semaine → heures/mois : 52 semaines ÷ 12 mois = 4,3333 (aucune estimation).
const SEMAINES_PAR_MOIS = 52 / 12;

/** Champs numériques d'une PayrollLine produits par le calcul (hors payrollRunId/employeeId). */
export type DonneesLignePaie = {
  joursPayes100: number;
  joursPayes2_3: number;
  joursNonPayes: number;
  nombreAbsences: number;
  remuneration100: number;
  remuneration2_3: number;
  hsValorisee: number;
  heuresTravaillees: number;
  heuresContractuelles: number;
  heuresSupp30: number;
  heuresSupp60: number;
  heuresSupp100: number;
  joursCongePris: number;
  indemniteCongesUSD: number;
  fraisMedicauxUSD: number;
  transportUSD: number;
  primesUSD: number;
  acompteUSD: number;
  salBrutUSD: number;
  cnssSalarieUSD: number;
  netImposableUSD: number;
  iprCalculeUSD: number;
  allocFamilialeUSD: number;
  salNetUSD: number;
  salNetCDF: number;
  cnssPatronalUSD: number;
  inppUSD: number;
  onemUSD: number;
  coutEmployeurUSD: number;
  coutEmployeurCDF: number;
};

/** Une ligne de paie calculée (sans écriture en base) : les champs d'une PayrollLine + l'employé. */
export type LigneCalculee = {
  employee: Employee;
  data: DonneesLignePaie;
};

export type ResultatBatch = {
  lignes: LigneCalculee[];
  /** Employés dont le solde « frais médicaux du mois » doit être remis à zéro à la persistance. */
  employesFraisMedicaux: string[];
};

/**
 * Calcule EN MÉMOIRE la paie de TOUS les employés actifs pour le mois donné, à partir des
 * données courantes (présences, HS, primes, acomptes, congés, planning multi-rôles). Aucune
 * écriture en base : sert à la fois à la persistance (`calculerPaieDuMois`) et à l'aperçu temps
 * réel de la page Paie. Reprend à l'identique la logique de paie (§8, transport B3, Option A,
 * Lot D). L'appelant décide de figer/écrire et de sauter les lignes déjà validées/payées.
 */
export async function calculerLignesPaie(mois: number, annee: number): Promise<ResultatBatch> {
  const parametres = await chargerParametresPaie();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [employees, joursFeriesDuMois, attendances, overtimeEntries, primesDuMois, acomptesDuMois, congesDuMois, fraisMedDuMois] =
    await Promise.all([
      prisma.employee.findMany({ where: { actif: true } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.prime.findMany({ where: { mois, annee } }),
      prisma.acompteSalaire.findMany({ where: { mois, annee, statut: "APPROUVE" } }),
      prisma.leaveRequest.findMany({ where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } } }),
      prisma.fraisMedical.findMany({ where: { mois, annee } }),
    ]);

  const fraisMedParEmp = new Map<string, number>();
  for (const f of fraisMedDuMois) fraisMedParEmp.set(f.employeeId, (fraisMedParEmp.get(f.employeeId) ?? 0) + Number(f.montantUSD));

  const joursCongeParEmp = new Map<string, number>();
  for (const c of congesDuMois) {
    const debut = new Date(c.dateDebut) < debutMois ? debutMois : new Date(c.dateDebut);
    const fin = new Date(c.dateFin) > finMois ? finMois : new Date(c.dateFin);
    joursCongeParEmp.set(c.employeeId, (joursCongeParEmp.get(c.employeeId) ?? 0) + calculerJoursOuvrables(debut, fin, joursFeriesDuMois.map((f) => f.date)));
  }

  const primesParEmp = new Map<string, number>();
  for (const p of primesDuMois) primesParEmp.set(p.employeeId, (primesParEmp.get(p.employeeId) ?? 0) + Number(p.montantUSD));
  const acomptesParEmp = new Map<string, number>();
  for (const a of acomptesDuMois) acomptesParEmp.set(a.employeeId, (acomptesParEmp.get(a.employeeId) ?? 0) + Number(a.montantUSD));

  const joursFeries = new Set(joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10)));

  const codesParEmp = new Map<string, CodePresence[]>();
  const codeParJour = new Map<string, Map<string, string>>();
  for (const a of attendances) {
    (codesParEmp.get(a.employeeId) ?? codesParEmp.set(a.employeeId, []).get(a.employeeId)!).push(a.code as CodePresence);
    const iso = new Date(a.date).toISOString().slice(0, 10);
    (codeParJour.get(a.employeeId) ?? codeParJour.set(a.employeeId, new Map()).get(a.employeeId)!).set(iso, a.code);
  }
  const heuresParEmp = new Map<string, { date: Date; heuresTravaillees: number }[]>();
  const heureParJour = new Map<string, Map<string, number>>();
  for (const o of overtimeEntries) {
    (heuresParEmp.get(o.employeeId) ?? heuresParEmp.set(o.employeeId, []).get(o.employeeId)!).push({ date: new Date(o.date), heuresTravaillees: Number(o.heuresTravaillees) });
    const iso = new Date(o.date).toISOString().slice(0, 10);
    (heureParJour.get(o.employeeId) ?? heureParJour.set(o.employeeId, new Map()).get(o.employeeId)!).set(iso, Number(o.heuresTravaillees));
  }

  // Option A — paie multi-rôles : taux horaire du rôle de chaque jour (planning).
  const [creneauxMois, shiftsAvecTaux] = await Promise.all([
    prisma.planningCreneau.findMany({ where: { date: { gte: debutMois, lte: finMois } }, select: { employeeId: true, date: true, shiftId: true } }),
    prisma.shift.findMany({ select: { id: true, tauxHoraireUSD: true } }),
  ]);
  const tauxParShift = new Map<string, number>();
  for (const s of shiftsAvecTaux) if (s.tauxHoraireUSD != null) tauxParShift.set(s.id, Number(s.tauxHoraireUSD));
  const tauxRoleParJour = new Map<string, Map<string, number>>();
  for (const c of creneauxMois) {
    const t = tauxParShift.get(c.shiftId);
    if (t == null) continue;
    const iso = new Date(c.date).toISOString().slice(0, 10);
    (tauxRoleParJour.get(c.employeeId) ?? tauxRoleParJour.set(c.employeeId, new Map()).get(c.employeeId)!).set(iso, t);
  }

  const lignes: LigneCalculee[] = [];
  const employesFraisMedicaux: string[] = [];

  for (const employee of employees) {
    const codes = codesParEmp.get(employee.id) ?? [];
    const resume = resumerPresences(codes);
    const heuresHebdo = Number(employee.heuresHebdomadaires) || Number(employee.heuresParJour) * 6;
    const heuresMoisContrat = heuresHebdo * SEMAINES_PAR_MOIS;
    const tauxDefaut = Number(employee.salaireMensuel) / heuresMoisContrat;
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
      salaireHoraire: tauxDefaut,
      joursFeries,
      params: parametres,
    });

    const joursCongePris = Math.max(codes.filter((c) => c === "C").length, joursCongeParEmp.get(employee.id) ?? 0);
    const indemniteCongesUSD = joursCongePris * salaireJournalier;
    const nombreAbsences = codes.filter((c) => c === "A" || c === "N" || c === "S").length;
    const heuresContractuelles = Math.round(heuresMoisContrat * 100) / 100;

    const joursPresenceP = codes.filter((c) => c === "P").length;
    const transportUSD =
      employee.categorie === "BRIGADE"
        ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
        : Number(employee.transportMoisUSD);

    const codesJours = codeParJour.get(employee.id) ?? new Map<string, string>();
    const heuresJours = heureParJour.get(employee.id) ?? new Map<string, number>();
    let joursPayesNonTravailles = 0;
    let joursMaladie = 0;
    for (const [iso, code] of codesJours) {
      if ((heuresJours.get(iso) ?? 0) > 0) continue;
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
            { salaireBaseUSD: Number(employee.salaireMensuel), transportUSD, enfants: employee.enfants, fraisMedicauxUSD, primesUSD, acompteUSD },
            parametres
          );

    lignes.push({
      employee,
      data: {
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
        transportUSD,
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
      },
    });
  }

  return { lignes, employesFraisMedicaux };
}
