// Référence d'heures d'UN salarié pour un mois, avec ses avertissements : le SEUL chemin commun au lot
// de paie (paie-batch.ts) et à l'aperçu de la fiche (bulletin-live.ts). Spec 2026-09-23 §5 « Un seul
// calcul » : si les deux fichiers recopiaient cet assemblage, la fiche et la paie finiraient par
// diverger (c'est ainsi qu'un stagiaire avait reçu un faux bulletin le 2026-07-22).
import type { Employee } from "@prisma/client";
import type { ParametresPaie } from "@/lib/payroll";
import { calculerReferenceMois, type AvertissementPaie, type ResultatReference } from "@/lib/paie-reference";
import { avertissementCddEchu, detecterAvertissementsSaisie } from "@/lib/paie-avertissements";
import type { JoursEmploye } from "@/lib/paie-reference-donnees";

export type EntreesReferenceSalarie = {
  mois: number;
  annee: number;
  employee: Pick<Employee, "id" | "categorie" | "salaireMensuel" | "heuresHebdomadaires" | "heuresParJour" | "dateEmbauche">;
  /** Régime de paie : type du contrat ACTIF le plus récent, sinon celui de la fiche. */
  typeContrat: string;
  /** Entrée de `chargerJoursMois` pour ce salarié (`undefined` = défaut d'assemblage → erreur). */
  joursEmp: JoursEmploye | undefined;
  /** Sert au seul affichage de l'indemnité de congé (mode contrat) ; aucun effet sur les montants. */
  joursCongePris: number;
  parametres: ParametresPaie;
};

export type ReferenceSalarie = {
  ref: ResultatReference;
  /** Avertissements de calcul et de saisie de la ligne (jamais bloquants). */
  avertissements: AvertissementPaie[];
};

export function calculerReferenceSalarie(e: EntreesReferenceSalarie): ReferenceSalarie {
  const { employee, typeContrat, joursEmp, parametres } = e;
  // Paie sur heures planifiées (spec 2026-09-23) : brigade en CDD/CDI seulement. Tous les autres
  // passent `referencePlanningDepuis: null` → ancienne règle, à l'identique.
  const estBrigadePlanning = employee.categorie === "BRIGADE" && typeContrat !== "STAGE" && typeContrat !== "JOURNALIER";
  // `chargerJoursMois` rend une entrée pour CHAQUE id demandé : une absence serait un défaut
  // d'assemblage, jamais un « mois vide » à payer sur l'ancienne règle en silence.
  if (!joursEmp) throw new Error(`Jours du mois introuvables pour le salarié ${employee.id}`);
  const ref = calculerReferenceMois({
    annee: e.annee,
    mois: e.mois,
    // `JoursEmploye` passé EN ENTIER : sans les jours hors du mois, les fériés de la plage élargie
    // (jamais ceux du seul mois), les congés sans solde et la fin de contrat, le plafond des
    // semaines à cheval, les fériés d'un congé sans solde et le repli de fin de CDD seraient faux.
    jours: joursEmp.jours,
    joursHorsMois: joursEmp.joursHorsMois,
    joursFeries: joursEmp.joursFeries,
    joursCongeSansSolde: joursEmp.joursCongeSansSolde,
    dateFinContrat: joursEmp.dateFinContrat,
    salaireMensuel: Number(employee.salaireMensuel),
    heuresHebdomadaires: Number(employee.heuresHebdomadaires),
    heuresParJour: Number(employee.heuresParJour),
    dateEmbauche: new Date(employee.dateEmbauche),
    joursCongePris: e.joursCongePris,
    referencePlanningDepuis: estBrigadePlanning ? (parametres.referencePlanningDepuis ?? null) : null,
    params: parametres,
  });
  const avertissements: AvertissementPaie[] = estBrigadePlanning
    ? [
        ...ref.avertissements,
        ...detecterAvertissementsSaisie(joursEmp.saisie, { referencePlanning: ref.source === "PLANNING" }),
        ...avertissementCddEchu(joursEmp.cddEchuLe),
      ]
    : [];
  return { ref, avertissements };
}
