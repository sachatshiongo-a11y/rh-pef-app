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
    /** `netUSD` = salaire net HABITUEL : hors transport, avant acompte et retenue de prêt. */
    mois: number;
    annee: number;
    netUSD: string;
    brutUSD: string;
    allocationsUSD: string;
    tauxChange: string;
  };
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
