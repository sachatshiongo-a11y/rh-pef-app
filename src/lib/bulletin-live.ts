import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import { calculerEcheancePret } from "@/lib/prets";
import {
  calculerPaieBrigade,
  calculerPaieBackoffice,
  calculerPaieStage,
  type CodePresence,
  type LignePaie,
} from "@/lib/payroll";
import type { AvertissementPaie, SourceReference } from "@/lib/paie-reference";
import { chargerJoursMois } from "@/lib/paie-reference-donnees";
import { calculerReferenceSalarie } from "@/lib/paie-reference-salarie";

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
  // Indemnité de transport du mois, incluse dans `ligne.salNetUSD` mais non isolée par le moteur
  // (LignePaie) — exposée ici pour dériver le salaire net hors transport (@/lib/paie-net).
  transportUSD: number;
  // Référence d'heures du mois (spec 2026-09-23) : la MÊME que la ligne de paie du lot
  // (`heuresContractuelles`, `sourceReference`, `motifReference`, `avertissementsPaie`).
  reference: {
    source: SourceReference;
    motif: string | null;
    heuresReference: number;
    tauxMois: number;
    avertissements: AvertissementPaie[];
  };
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

  // BUG CONNU documenté (Tier 2, #4 — NON corrigé, montants impactés) : les heures faites ne sont
  // données à `calculerHeuresSupp` que pour les jours DU MOIS, alors qu'il regroupe par vraies semaines
  // lundi→dimanche → une semaine à cheval sur deux mois sous-évalue les heures supp. de chaque côté.
  // Voir l'explication complète et la piste de correction recommandée dans paie-batch.ts (même
  // assemblage `chargerJoursMois`, même moteur `calculerHeuresSupp`).
  const [attendances, primesDuMois, fraisMedDuMois, acomptesDuMois, pretsEnCours, avantagesDuMois, joursParEmp] =
    await Promise.all([
      prisma.attendance.findMany({ where: { employeeId, date: { gte: debutMois, lte: finMois } } }),
      prisma.prime.findMany({ where: { employeeId, mois, annee } }),
      prisma.fraisMedical.findMany({ where: { employeeId, mois, annee } }),
      prisma.acompteSalaire.findMany({ where: { employeeId, mois, annee, statut: "APPROUVE" } }),
      prisma.pretPersonnel.findMany({ where: { employeeId, statut: "EN_COURS" }, include: { retenues: true } }),
      // Informatifs : jamais injectés dans le moteur, uniquement remontés pour l'affichage.
      prisma.avantageNature.findMany({ where: { employeeId, mois, annee } }),
      // Jours du mois (créneaux, modèle, codes, heures), jours hors du mois des semaines à cheval,
      // fériés de la plage élargie, congés sans solde, fin de contrat : même assemblage que le lot.
      chargerJoursMois(mois, annee, [employeeId]),
    ]);

  const codes = attendances.map((a) => a.code as CodePresence);

  // Référence d'heures, base et heures supp. : le MÊME chemin que paie-batch.ts
  // (`calculerReferenceSalarie`). `joursCongePris` ne sert qu'à l'indemnité de congé affichée par le
  // lot en mode contrat, que l'aperçu n'expose pas : 0, sans effet sur aucun montant.
  const { ref, avertissements } = calculerReferenceSalarie({
    mois,
    annee,
    employee,
    typeContrat,
    joursEmp: joursParEmp.get(employeeId),
    joursCongePris: 0,
    parametres,
  });
  const hs = ref.hs;

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
            ...ref.moteur,
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
    transportUSD,
    reference: {
      source: ref.source,
      motif: ref.motif,
      heuresReference: ref.heuresReference,
      tauxMois: ref.tauxMois,
      avertissements,
    },
  };
}
