// Avertissements de SAISIE sur une ligne de paie — module PUR. Ne bloquent jamais : la Direction
// voit et tranche (spec paie-heures-planifiees §6.3). Les avertissements de CALCUL (repli, taux de
// rôle, taux du mois) viennent de `calculerReferenceMois` (paie-reference.ts).
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import type { AvertissementPaie } from "@/lib/paie-reference";

export type JourSaisie = {
  date: Date; // date PURE (minuit UTC)
  code: string | null;
  codeSaisiLe: Date | null; // Attendance.createdAt
  heuresFaites: number;
  heuresSaisiesLe: Date | null; // OvertimeEntry.createdAt
  heuresModifieesLe: Date | null; // OvertimeEntry.updatedAt
  heuresPlanifiees: number; // durée du créneau de TRAVAIL, 0 sinon
  creneauModifieLe: Date | null; // PlanningCreneau.updatedAt, null sans créneau
};

const jjmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const avant = (instant: Date | null, jour: Date) => instant != null && jourCivilKinshasa(instant).getTime() < jour.getTime();

export function detecterAvertissementsSaisie(jours: JourSaisie[], opts: { referencePlanning: boolean }): AvertissementPaie[] {
  const tries = [...jours].sort((a, b) => a.date.getTime() - b.date.getTime());
  const sortie: AvertissementPaie[] = [];
  const pousser = (code: AvertissementPaie["code"], libelle: string, js: JourSaisie[]) => {
    if (js.length > 0) sortie.push({ code, message: `${libelle} (${js.length} j) : ${js.map((j) => jjmm(j.date)).join(", ")}` });
  };

  pousser("SAISIE_ANTICIPEE", "Saisi d'avance", tries.filter((j) =>
    (j.code != null && avant(j.codeSaisiLe, j.date)) || (j.heuresFaites > 0 && avant(j.heuresSaisiesLe, j.date))));

  if (opts.referencePlanning) {
    pousser("PRESENCE_SANS_CRENEAU", "Travail hors planning", tries.filter((j) =>
      (j.code === "P" || j.heuresFaites > 0) && j.heuresPlanifiees <= 0));
    // Décision du contrôleur (post-tâche 2) : un jour codé P avec un créneau de travail gonfle déjà
    // la référence R via `hsPlan` dans `calculerReferenceMois`, qu'il soit ou non payé — s'il n'a
    // AUCUNE heure saisie, il n'est payé nulle part : une retenue silencieuse sur un salaire censé
    // être complet. Distinct de PRESENCE_SANS_CRENEAU (présence SANS créneau, cas symétrique).
    pousser("PRESENCE_SANS_HEURES", "Présent sans heures saisies : jour retenu", tries.filter((j) =>
      j.code === "P" && j.heuresPlanifiees > 0 && j.heuresFaites <= 0));
    pousser("PLANNING_MODIFIE_APRES_HEURES", "Planning modifié après la saisie des heures", tries.filter((j) =>
      j.heuresPlanifiees > 0 && j.heuresFaites > 0 && j.creneauModifieLe != null && j.heuresModifieesLe != null &&
      j.creneauModifieLe.getTime() > j.heuresModifieesLe.getTime() && Math.abs(j.heuresFaites - j.heuresPlanifiees) > 0.01));
  }
  return sortie;
}

/**
 * CDD échu mais poursuivi (décision du contrôleur, 2026-09-23) : l'assemblage (`chargerJoursMois`)
 * ignore une fin de contrat suivie de travail dans le mois et rend sa date dans `cddEchuLe`. La
 * paie se calcule alors comme pour un CDI de fait ; cet avertissement dit à la Direction qu'aucun
 * renouvellement n'est enregistré. Rien si `cddEchuLe` est `null`.
 */
export function avertissementCddEchu(cddEchuLe: Date | null): AvertissementPaie[] {
  if (cddEchuLe == null) return [];
  const date = `${jjmm(cddEchuLe)}/${cddEchuLe.getUTCFullYear()}`;
  return [{ code: "CDD_ECHU_POURSUIVI", message: `CDD échu le ${date} sans renouvellement enregistré : le salarié a continué à travailler.` }];
}

const CODES: ReadonlySet<string> = new Set<AvertissementPaie["code"]>([
  "REPLI_CONTRAT", "TAUX_ROLE_IGNORE", "TAUX_MOIS_SUPERIEUR_HS", "SAISIE_ANTICIPEE", "PRESENCE_SANS_CRENEAU", "PRESENCE_SANS_HEURES", "PLANNING_MODIFIE_APRES_HEURES",
  "CDD_ECHU_POURSUIVI", "CONGE_SANS_SOLDE_RECODE", "SEMAINE_A_CHEVAL_NON_PLANIFIEE",
]);

/** Relit la colonne JSON `PayrollLine.avertissementsPaie` : ne garde que les entrées bien formées
 *  (une colonne JSON n'a pas de schéma ; une ligne ancienne ou abîmée ne doit pas faire planter l'écran). */
export function lireAvertissements(json: unknown): AvertissementPaie[] {
  if (!Array.isArray(json)) return [];
  return json.filter((a): a is AvertissementPaie =>
    typeof a === "object" && a !== null && CODES.has((a as { code?: unknown }).code as string) &&
    typeof (a as { message?: unknown }).message === "string");
}
