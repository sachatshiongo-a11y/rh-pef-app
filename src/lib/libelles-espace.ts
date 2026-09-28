// Libellés EN CLAIR de ce que l'espace salarié affiche. Une valeur brute d'énumération
// (« EN_ATTENTE », « CERTIFICAT_MEDICAL », « DEMANDE_CONGE »…) ne doit jamais atteindre l'écran
// d'un salarié : chaque statut, chaque type passe par ici. Une valeur inconnue devient un libellé
// neutre, jamais la valeur brute (voir libelles-espace.test.ts).

/** Statut d'une DEMANDE (congé, acompte, échange, changement de shift) — d'où le féminin. */
export const STATUT_DEMANDE: Record<string, { label: string; classe: string }> = {
  EN_ATTENTE: { label: "En attente", classe: "bg-amber-100 text-amber-800" },
  APPROUVE: { label: "Acceptée", classe: "bg-emerald-100 text-emerald-800" },
  REFUSE: { label: "Refusée", classe: "bg-red-100 text-red-800" },
  ANNULE: { label: "Annulée", classe: "bg-muted text-muted-foreground" },
};

export function statutDemande(statut: string): { label: string; classe: string } {
  return STATUT_DEMANDE[statut] ?? { label: "Statut inconnu", classe: "bg-muted text-muted-foreground" };
}

/** Type d'un document du dossier (DocumentEmploye.type) — partagé avec la fiche RH. */
export const LIBELLE_TYPE_DOCUMENT: Record<string, string> = {
  CONTRAT: "Contrat",
  CARTE_IDENTITE: "Carte d'identité",
  DIPLOME: "Diplôme",
  PHOTO: "Photo",
  CV: "CV",
  CERTIFICAT_MEDICAL: "Certificat médical",
  AVERTISSEMENT: "Avertissement",
  LETTRE: "Lettre",
  AUTRE: "Autre",
};

export function libelleTypeDocument(type: string): string {
  return LIBELLE_TYPE_DOCUMENT[type] ?? "Document";
}

/** Ce qu'on a signé, pour une phrase (« Votre bulletin de paie a été signé. »). */
export const NOM_CIBLE_SIGNATURE: Record<string, string> = {
  CONTRAT: "contrat",
  BULLETIN: "bulletin de paie",
  DEMANDE_CONGE: "demande de congé",
};

/** Phrase de la notification envoyée au salarié quand la Direction recueille sa signature. */
export function messageSignatureRecueillie(cible: string): string {
  const nom = NOM_CIBLE_SIGNATURE[cible] ?? "document";
  const accord = cible === "DEMANDE_CONGE" ? "signée" : "signé";
  return `Votre ${nom} a été ${accord} en présence de la Direction.`;
}

/** L'écran de l'espace salarié où se trouve ce document. */
export const PAGE_CIBLE_SIGNATURE: Record<string, string> = {
  CONTRAT: "/espace/contrats",
  BULLETIN: "/espace/documents",
  DEMANDE_CONGE: "/espace/conges",
};
