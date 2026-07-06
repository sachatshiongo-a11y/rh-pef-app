import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import {
  calculerHeuresSupp,
  calculerPaieBrigade,
  calculerPaieBackoffice,
  type CodePresence,
  type LignePaie,
} from "@/lib/payroll";

export type ApercuBulletin = {
  ligne: LignePaie;
  heuresTravaillees: number;
  hs30: number;
  hs60: number;
  hs100: number;
  joursPresenceP: number;
  primesUSD: number;
  acompteUSD: number;
  tauxChangeCDF: number;
};

/**
 * Calcule EN DIRECT le bulletin d'un employé pour une période (sans écrire en base) — sert à
 * l'aperçu intégré dans la fiche. Reprend exactement la logique de `calculerPaieDuMois`
 * (paie aux heures §8, transport B3, primes & acompte approuvé Lot D).
 */
export async function calculerBulletinLive(
  employeeId: string,
  mois: number,
  annee: number
): Promise<ApercuBulletin | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;

  const parametres = await chargerParametresPaie();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  const [attendances, overtimeEntries, joursFeriesDuMois, primesDuMois, fraisMedDuMois, acomptesDuMois, creneauxMois] =
    await Promise.all([
      prisma.attendance.findMany({ where: { employeeId, date: { gte: debutMois, lte: finMois } } }),
      prisma.overtimeEntry.findMany({ where: { employeeId, date: { gte: debutMois, lte: finMois } } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.prime.findMany({ where: { employeeId, mois, annee } }),
      prisma.fraisMedical.findMany({ where: { employeeId, mois, annee } }),
      prisma.acompteSalaire.findMany({ where: { employeeId, mois, annee, statut: "APPROUVE" } }),
      prisma.planningCreneau.findMany({
        where: { employeeId, date: { gte: debutMois, lte: finMois } },
        include: { shift: { select: { tauxHoraireUSD: true } } },
      }),
    ]);

  const joursFeries = new Set(joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10)));
  const codes = attendances.map((a) => a.code as CodePresence);

  // Option A — taux horaire effectif (pondéré par les heures selon le taux du rôle de chaque jour).
  // Heures/mois = heures/semaine × 52/12 (précis, indépendant du nb de jours travaillés/jour).
  const heuresHebdo = Number(employee.heuresHebdomadaires) || Number(employee.heuresParJour) * 6;
  const heuresMoisContrat = (heuresHebdo * 52) / 12;
  const tauxDefaut = Number(employee.salaireMensuel) / heuresMoisContrat;
  const tauxRoleParJour = new Map<string, number>();
  for (const c of creneauxMois) {
    if (c.shift?.tauxHoraireUSD != null)
      tauxRoleParJour.set(new Date(c.date).toISOString().slice(0, 10), Number(c.shift.tauxHoraireUSD));
  }
  let sommeH = 0;
  let sommeHT = 0;
  for (const o of overtimeEntries) {
    const h = Number(o.heuresTravaillees);
    if (h <= 0) continue;
    const iso = new Date(o.date).toISOString().slice(0, 10);
    sommeH += h;
    sommeHT += h * (tauxRoleParJour.get(iso) ?? tauxDefaut);
  }
  const salaireHoraire = sommeH > 0 ? sommeHT / sommeH : tauxDefaut;
  const salaireJournalier = salaireHoraire * Number(employee.heuresParJour);

  const hs = calculerHeuresSupp({
    jours: overtimeEntries.map((o) => ({ date: new Date(o.date), heuresTravaillees: Number(o.heuresTravaillees) })),
    heuresParJourContrat: Number(employee.heuresParJour),
    heuresHebdoContrat: Number(employee.heuresHebdomadaires),
    // Majorations HS sur le taux PAR DÉFAUT (inchangées) ; seule la base multi-rôles varie.
    salaireHoraire: tauxDefaut,
    joursFeries,
    params: parametres,
  });

  // Partage jours travaillés / jours payés non travaillés (§8).
  const codeParJour = new Map<string, string>();
  for (const a of attendances) codeParJour.set(new Date(a.date).toISOString().slice(0, 10), a.code);
  const heureParJour = new Map<string, number>();
  for (const o of overtimeEntries)
    heureParJour.set(new Date(o.date).toISOString().slice(0, 10), Number(o.heuresTravaillees));
  let joursPayesNonTravailles = 0;
  let joursMaladie = 0;
  for (const [iso, code] of codeParJour) {
    if ((heureParJour.get(iso) ?? 0) > 0) continue;
    if (code === "O" || code === "A" || code === "C" || code === "F") joursPayesNonTravailles++;
    else if (code === "M") joursMaladie++;
  }

  const joursPresenceP = codes.filter((c) => c === "P").length;
  const transportUSD =
    employee.categorie === "BRIGADE"
      ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
      : Number(employee.transportMoisUSD);
  const primesUSD = primesDuMois.reduce((s, p) => s + Number(p.montantUSD), 0);
  const acompteUSD = acomptesDuMois.reduce((s, a) => s + Number(a.montantUSD), 0);
  const fraisMedicauxUSD =
    Number(employee.fraisMedicauxMoisCourant) + fraisMedDuMois.reduce((s, f) => s + Number(f.montantUSD), 0);

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
            transportUSD,
            enfants: employee.enfants,
            fraisMedicauxUSD,
            primesUSD,
            acompteUSD,
          },
          parametres
        );

  return {
    ligne,
    heuresTravaillees: hs.heuresTotalesMois,
    hs30: hs.hs30,
    hs60: hs.hs60,
    hs100: hs.hs100,
    joursPresenceP,
    primesUSD,
    acompteUSD,
    tauxChangeCDF: parametres.tauxChangeCDF,
  };
}
