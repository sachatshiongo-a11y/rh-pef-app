import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import { calculerEcheancePret } from "@/lib/prets";
import {
  calculerHeuresSupp,
  calculerPaieBrigade,
  calculerPaieBackoffice,
  calculerPaieStage,
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
  primes: { nom: string; montantUSD: number }[]; // détail des primes (une entrée chacune)
  // Avantages en nature : INFORMATIFS. Remontés pour l'affichage seul, exclus de tout calcul.
  avantagesNatureUSD: number;
  avantagesNature: { nature: string; montantUSD: number }[];
  acompteUSD: number;
  tauxChangeCDF: number;
};

/**
 * Calcule EN DIRECT le bulletin d'un employé pour une période (sans écrire en base) — sert à
 * l'aperçu intégré dans la fiche. Reprend la logique de `calculerLignesPaie` (paie-batch.ts) :
 * paie aux heures §8, transport B3, primes & acompte approuvé Lot D, ET le régime de contrat
 * (STAGE → indemnité forfaitaire sans cotisations ni IPR ; INTERIM → aucun bulletin, l'employé
 * est payé par l'agence). Corrigé le 2026-07-22 : avant, seule la catégorie BRIGADE/back-office
 * était testée, produisant un faux bulletin (avec cotisations jamais prélevées) pour un stagiaire
 * et un bulletin fictif pour un intérimaire.
 */
export async function calculerBulletinLive(
  employeeId: string,
  mois: number,
  annee: number
): Promise<ApercuBulletin | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;

  // Régime de paie : type du contrat ACTIF le plus récent, sinon le type de la fiche — même
  // règle que paie-batch.ts (typeContratParEmp).
  const contratActif = await prisma.contrat.findFirst({
    where: { employeeId, statut: "ACTIF" },
    orderBy: { dateDebut: "desc" },
    select: { type: true },
  });
  const typeContrat = contratActif?.type ?? employee.contrat;

  // INTERIMAIRE : salarié de l'AGENCE (qui l'emploie et le paie) — aucun bulletin ici.
  if (typeContrat === "INTERIM") return null;
  const estStage = typeContrat === "STAGE";

  const parametres = await chargerParametresPaie();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  // BUG CONNU documenté (Tier 2, #4 — NON corrigé, montants impactés) : `overtimeEntries` est filtré
  // strictement par mois calendaire, alors que `calculerHeuresSupp` regroupe par vraies semaines
  // lundi→dimanche → une semaine à cheval sur deux mois sous-évalue les heures supp. de chaque côté.
  // Voir l'explication complète et la piste de correction recommandée dans paie-batch.ts (même fenêtre
  // de requête, même moteur `calculerHeuresSupp`).
  const [attendances, overtimeEntries, joursFeriesDuMois, primesDuMois, fraisMedDuMois, acomptesDuMois, creneauxMois, pretsEnCours, avantagesDuMois] =
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
      prisma.pretPersonnel.findMany({ where: { employeeId, statut: "EN_COURS" }, include: { retenues: true } }),
      // Informatifs : jamais injectés dans le moteur, uniquement remontés pour l'affichage.
      prisma.avantageNature.findMany({ where: { employeeId, mois, annee } }),
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
    // Majorations HS sur le taux PAR DÉFAUT (inchangées) ; seule la base multi-rôles varie (Option
    // A). DÉCISION (à faire confirmer par le client, 2026-07-22) : la PRIME d'heures supp. est donc
    // valorisée sur le taux horaire CONTRACTUEL par défaut de l'employé, pas sur le taux pondéré du
    // rôle réellement tenu le jour concerné — cohérent avec « prime calculée sur la base
    // contractuelle », mais à valider explicitement si un employé multi-rôles fait ses heures supp.
    // sur un rôle mieux (ou moins bien) rémunéré que son rôle par défaut. Voir même décision dans
    // paie-batch.ts.
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
  // Échéance de prêt du mois : min(retenue mensuelle, solde avant ce mois). Idempotent au recalcul.
  const retenuePretUSD = pretsEnCours.reduce(
    (s, p) =>
      s +
      calculerEcheancePret(
        Number(p.montantUSD),
        Number(p.retenueMensuelleUSD),
        p.retenues.map((r) => ({ mois: r.mois, annee: r.annee, montantUSD: Number(r.montantUSD) })),
        mois,
        annee
      ).echeanceUSD,
    0
  );
  const fraisMedicauxUSD =
    Number(employee.fraisMedicauxMoisCourant) + fraisMedDuMois.reduce((s, f) => s + Number(f.montantUSD), 0);

  const ligne = estStage
    ? calculerPaieStage(
        { indemniteUSD: Number(employee.salaireMensuel), transportUSD, fraisMedicauxUSD, primesUSD, acompteUSD, retenuePretUSD },
        parametres
      )
    : employee.categorie === "BRIGADE"
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
            retenuePretUSD,
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
            retenuePretUSD,
          },
          parametres
        );

  return {
    ligne,
    // Heures travaillées : toujours informatives (même pour un stagiaire), comme paie-batch.ts.
    heuresTravaillees: hs.heuresTotalesMois,
    // Stage : pas d'heures supp. valorisées (indemnité forfaitaire, même règle que paie-batch.ts).
    hs30: estStage ? 0 : hs.hs30,
    hs60: estStage ? 0 : hs.hs60,
    hs100: estStage ? 0 : hs.hs100,
    joursPresenceP,
    primesUSD,
    primes: primesDuMois.map((p) => ({ nom: p.nom, montantUSD: Number(p.montantUSD) })),
    avantagesNatureUSD: avantagesDuMois.reduce((s, a) => s + Number(a.montantUSD), 0),
    avantagesNature: avantagesDuMois.map((a) => ({ nature: a.nature, montantUSD: Number(a.montantUSD) })),
    acompteUSD,
    tauxChangeCDF: parametres.tauxChangeCDF,
  };
}
