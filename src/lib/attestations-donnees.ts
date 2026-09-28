// CE QU'UNE ATTESTATION IMPRIME — l'instantané figé à la délivrance (`Attestation.donnees`).
//
// Module PUR (ni base, ni `server-only`) : le PDF, les écrans et les tests le lisent. Tout y est en
// chaînes ou en booléens : les dates en `AAAA-MM-JJ`, les montants en dollars à deux décimales.
// Le PDF se régénère à l'identique depuis ces valeurs — jamais depuis la fiche du jour, qui a pu
// bouger (salaire revu, poste changé) depuis que l'attestation a été signée par la Direction.

export type TypeAttestationCode = "TRAVAIL" | "SALAIRE" | "STAGE";

export type DonneesAttestation = {
  type: TypeAttestationCode;
  nom: string;
  sexe: string;
  matricule: string;
  poste: string;
  /** Type du dernier contrat, EN CLAIR (« CDI — durée indéterminée »). */
  typeContrat: string;
  /** Date d'embauche (`Employee.dateEmbauche`), `AAAA-MM-JJ`. */
  dateEmbauche: string;
  /** Salarié actif au jour de la délivrance : « et est toujours en fonction à ce jour ». */
  enPoste: boolean;
  /** Sorti : date de sortie ou fin du dernier contrat, `AAAA-MM-JJ`. */
  dateSortie: string | null;
  /** Attestation de salaire : la dernière paie VALIDE ou PAYE. */
  salaire?: {
    /**
     * `netUSD` = salaire net HABITUEL : hors transport et frais médicaux remboursés, avant acompte
     * et retenue de prêt. `brutUSD` = brut HORS transport (assiette CNSS/IPR, comme le bulletin).
     */
    mois: number;
    annee: number;
    netUSD: string;
    brutUSD: string;
    allocationsUSD: string;
    tauxChange: string;
  };
  /**
   * Vrai quand l'attestation RÉPOND à une demande du salarié : le PDF écrit alors « délivrée à
   * l'intéressé(e), à sa demande ». Une délivrance à l'initiative de la Direction ne le prétend pas.
   */
  aSaDemande?: boolean;
  /**
   * Obtenue par le salarié lui-même, en libre-service (attestation de salaire du mois, décision
   * Direction 2026-09-28) — le registre l'affiche « Libre-service ». Même PDF, même signature.
   */
  libreService?: boolean;
  /** Attestation de stage : le dernier contrat de stage. */
  stage?: { debut: string; fin: string | null };
};

export const LIBELLE_TYPE_ATTESTATION: Record<TypeAttestationCode, string> = {
  TRAVAIL: "Attestation de travail",
  SALAIRE: "Attestation de salaire",
  STAGE: "Attestation de stage",
};

/** Libellé court pour une phrase (« votre attestation de travail »). */
export const NOM_TYPE_ATTESTATION: Record<TypeAttestationCode, string> = {
  TRAVAIL: "attestation de travail",
  SALAIRE: "attestation de salaire",
  STAGE: "attestation de stage",
};

export const LIBELLE_STATUT_ATTESTATION: Record<"DEMANDEE" | "DELIVREE" | "REFUSEE", string> = {
  DEMANDEE: "Demandée",
  DELIVREE: "Délivrée",
  REFUSEE: "Refusée",
};

export function estTypeAttestation(v: unknown): v is TypeAttestationCode {
  return v === "TRAVAIL" || v === "SALAIRE" || v === "STAGE";
}

/** `ATT-2026-0007` — le rang vient de la séquence de l'année, jamais d'un comptage. */
export function numeroAttestation(annee: number, rang: number): string {
  return `ATT-${annee}-${String(rang).padStart(4, "0")}`;
}

/** Vrai si l'attestation a été obtenue par le salarié en libre-service (lu dans l'instantané). */
export function estLibreService(donnees: unknown): boolean {
  return typeof donnees === "object" && donnees !== null && (donnees as { libreService?: unknown }).libreService === true;
}
