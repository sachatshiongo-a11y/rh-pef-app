// Composition familiale — fonctions PURES (aucune I/O), même convention que src/lib/payroll.ts.
//
// Règle cardinale (décision 2026-08-16) : ce module CONSTATE et SIGNALE, il ne décide pas.
// `Employee.enfants` reste la seule source du nombre d'enfants utilisé par la paie (réduction IPR,
// allocation familiale). Le comptage ci-dessous sert à afficher un écart, jamais à le corriger
// automatiquement — un enfant qui « tombe » à charge change un montant payé, et cette décision
// appartient à la Direction, pas au logiciel.

export type MembreFamilleLu = {
  lien: "CONJOINT" | "ENFANT";
  nom: string;
  dateNaissance: Date | null;
};

/**
 * Âge en ANNÉES RÉVOLUES à une date de référence — compare aussi le mois et le jour, pas seulement
 * l'année : né le 3 septembre 2008, on n'a pas 18 ans le 1er septembre 2026. Même exigence que
 * `ancienneteEnMois` dans payroll.ts, pour la même raison (un comptage trop généreux gonfle un droit).
 */
export function ageEnAnnees(dateNaissance: Date, dateRef: Date): number {
  let ans = dateRef.getUTCFullYear() - dateNaissance.getUTCFullYear();
  const moisEcart = dateRef.getUTCMonth() - dateNaissance.getUTCMonth();
  if (moisEcart < 0 || (moisEcart === 0 && dateRef.getUTCDate() < dateNaissance.getUTCDate())) ans--;
  return Math.max(0, ans);
}

export type ComptageFamille = {
  /** Enfants dont la date de naissance est connue ET qui sont sous l'âge limite. */
  enfantsACharge: number;
  /** Tous les enfants saisis, à charge ou non. */
  enfantsTotal: number;
  /** Enfants saisis SANS date de naissance : impossible de trancher, donc jamais comptés à charge. */
  enfantsSansDate: number;
  /** Nom du conjoint s'il est saisi (un seul retenu — le premier). */
  conjoint: string | null;
};

export function compterFamille(
  membres: MembreFamilleLu[],
  dateRef: Date,
  ageLimite: number
): ComptageFamille {
  const enfants = membres.filter((m) => m.lien === "ENFANT");
  const sansDate = enfants.filter((e) => e.dateNaissance === null);
  const aCharge = enfants.filter(
    (e) => e.dateNaissance !== null && ageEnAnnees(e.dateNaissance, dateRef) < ageLimite
  );
  const conjoint = membres.find((m) => m.lien === "CONJOINT");

  return {
    enfantsACharge: aCharge.length,
    enfantsTotal: enfants.length,
    enfantsSansDate: sansDate.length,
    conjoint: conjoint?.nom ?? null,
  };
}

export type EcartFamille = {
  /** Valeur utilisée par la paie (Employee.enfants) — inchangée par ce module. */
  compteurPaie: number;
  /** Ce que donne la fiche nominative. */
  deduitDesDates: number;
  message: string;
};

/**
 * Compare le compteur qui pilote la paie à ce que dit la fiche nominative. Renvoie `null` quand
 * les deux concordent — ou quand la fiche est vide (rien de saisi ne veut pas dire « zéro enfant »,
 * ça veut dire « pas encore renseigné », et signaler ça à chaque fiche noierait les vrais écarts).
 */
export function ecartCompositionFamiliale(
  compteurPaie: number,
  comptage: ComptageFamille
): EcartFamille | null {
  if (comptage.enfantsTotal === 0) return null;
  if (comptage.enfantsACharge === compteurPaie && comptage.enfantsSansDate === 0) return null;

  const details: string[] = [];
  if (comptage.enfantsACharge !== compteurPaie) {
    details.push(
      `la fiche nominative en donne ${comptage.enfantsACharge} à charge sur ${comptage.enfantsTotal} saisi(s)`
    );
  }
  if (comptage.enfantsSansDate > 0) {
    details.push(
      `${comptage.enfantsSansDate} enfant(s) sans date de naissance, donc non comptés à charge`
    );
  }

  return {
    compteurPaie,
    deduitDesDates: comptage.enfantsACharge,
    message: `La paie retient ${compteurPaie} enfant(s) à charge, mais ${details.join(" et ")}. Corrigez le compteur ou la fiche — le calcul n'a pas été modifié.`,
  };
}
