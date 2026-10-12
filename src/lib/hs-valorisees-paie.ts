import "server-only";

import type { Employee } from "@prisma/client";
import { calculerPaieBrigade, type ParametresPaie } from "@/lib/payroll";
import { chargerJoursMois } from "@/lib/paie-reference-donnees";
import { calculerReferenceSalarie } from "@/lib/paie-reference-salarie";
import { estCalculeEnPaie, typesContratActifs } from "@/lib/paie-hors-calcul";
import { prisma } from "@/lib/prisma";

// « HS VALORISÉES » DE L'ÉCRAN PRÉSENCES ET DE SON EXPORT — le chiffre de la PAIE (audit RH
// 2026-10-10). L'écran les valorisait à salaire ÷ 26 ÷ heures/jour, alors que la paie les paie au
// taux du CONTRAT (salaire ÷ (heures/semaine × 52/12)), au brut reconstitué, moins la base d'un férié
// travaillé déjà payée au forfait : deux montants pour la même heure. Ici, le MÊME chemin que le lot
// de paie (`calculerReferenceSalarie` puis `calculerPaieBrigade`) ; seule la prime d'heures supp. est
// lue (elle ne dépend ni du transport, ni des primes, ni des retenues).
//
// `montant: null` = la paie ne paie pas d'heures supp. à ce salarié (back-office au salaire fixe,
// stage, intérim, fiche hors du calcul) : à afficher « — », jamais 0.

export type HsPaie = {
  montant: number | null;
  /** Taux horaire de la paie pour les HS (taux du contrat × facteur brut/net) ; null si `montant` l'est. */
  tauxHoraire: number | null;
};

type EmployePaie = Pick<Employee, "id" | "actif" | "contrat" | "categorie" | "salaireMensuel" | "heuresHebdomadaires" | "heuresParJour" | "dateEmbauche" | "enfants">;

export async function hsValoriseesPaie(mois: number, annee: number, employes: EmployePaie[], parametres: ParametresPaie): Promise<Map<string, HsPaie>> {
  const res = new Map<string, HsPaie>();
  if (employes.length === 0) return res;
  const ids = employes.map((e) => e.id);
  const [types, jours] = await Promise.all([typesContratActifs(prisma, ids), chargerJoursMois(mois, annee, ids)]);
  for (const e of employes) {
    const typeContrat = types.get(e.id) ?? e.contrat;
    if (!estCalculeEnPaie(e, types.get(e.id)) || typeContrat === "STAGE" || e.categorie !== "BRIGADE") {
      res.set(e.id, { montant: null, tauxHoraire: null });
      continue;
    }
    const { ref } = calculerReferenceSalarie({ mois, annee, employee: e, typeContrat, joursEmp: jours.get(e.id), joursCongePris: 0, parametres });
    const ligne = calculerPaieBrigade(
      { ...ref.moteur, transportMoisUSD: 0, enfants: e.enfants, fraisMedicauxUSD: 0, primesUSD: 0, acompteUSD: 0, retenuePretUSD: 0 },
      parametres,
    );
    res.set(e.id, { montant: ligne.hsValorisee, tauxHoraire: ref.tauxContrat * (ligne.facteurReconstitution ?? 1) });
  }
  return res;
}

/**
 * « HS VALORISÉES » D'UN MOIS PASSÉ : le montant FIGÉ du bulletin de ce mois-là (`PayrollLine.hsValorisee`
 * des lignes VALIDÉES ou PAYÉES), jamais un recalcul. `hsValoriseesPaie` reprend le moteur avec les
 * paramètres, la fiche (salaire, contrat, catégorie, état actif) et les heures d'AUJOURD'HUI : sur un mois
 * clôturé, il pouvait afficher un montant que personne n'a payé (salaire augmenté depuis, salarié sorti
 * affiché « — » alors que ses HS ont été payées).
 *
 * Sans bulletin figé (mois antérieur à l'outil, ligne hors calcul, paie jamais calculée) : `montant: null`
 * → « — », jamais un chiffre provisoire présenté comme celui de la paie. Une ligne figée à 0 d'un salarié
 * hors brigade reste « — » (la paie ne lui paie pas d'HS), comme sur le mois courant.
 *
 * `tauxHoraire` est toujours null : le taux n'est pas figé sur la ligne, et le recalculer avec la fiche
 * d'aujourd'hui serait justement ce qu'on évite (l'export n'affiche donc pas la valorisation semaine par
 * semaine d'un mois passé : « — »).
 */
export async function hsValoriseesFigees(mois: number, annee: number, employes: Pick<Employee, "id" | "categorie">[]): Promise<Map<string, HsPaie>> {
  const res = new Map<string, HsPaie>();
  if (employes.length === 0) return res;
  const lignes = await prisma.payrollLine.findMany({
    where: { payrollRun: { mois, annee }, employeeId: { in: employes.map((e) => e.id) }, statutPaiement: { in: ["VALIDE", "PAYE"] } },
    select: { employeeId: true, hsValorisee: true },
  });
  const parEmploye = new Map(lignes.map((l) => [l.employeeId, Number(l.hsValorisee)]));
  for (const e of employes) {
    const montant = parEmploye.get(e.id);
    res.set(e.id, { montant: montant === undefined || (montant === 0 && e.categorie !== "BRIGADE") ? null : montant, tauxHoraire: null });
  }
  return res;
}
