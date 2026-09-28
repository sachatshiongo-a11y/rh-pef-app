import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// CLASSEMENT D'UN CONTRAT — dérivé, jamais stocké (spec 2026-09-28, §3.1).
//
// Le statut enregistré (`Contrat.statut`) ne dit pas tout : `EXPIRE` n'était jamais posé, et
// plusieurs contrats pouvaient rester ACTIF en même temps. Plutôt que de réécrire la base en
// silence, on DÉRIVE ce que le salarié et la Direction doivent voir. Seul un clic de la Direction
// (« Marquer expiré », clôture proposée à la création) écrit un nouveau statut.
//
// Une seule fonction pour les deux côtés : l'espace salarié et les écrans de la Direction ne
// peuvent pas dire « en vigueur » d'un côté et « expiré » de l'autre.
//
// Module PUR (ni base, ni `server-only`) : les pages serveur et les tests l'importent tels quels.

export type CategorieContrat = "A_SIGNER" | "EN_VIGUEUR" | "ANCIEN";

export type ContratClassable = {
  id: string;
  type: string;
  statut: string;
  /** Dates métier pures (`@db.Date`, minuit UTC). */
  dateDebut: Date;
  dateFin: Date | null;
  createdAt: Date;
};

export type Classement = {
  categorie: CategorieContrat;
  /** Pourquoi le contrat est ancien (« expiré le 31/08/2026 », « résilié »…) ; null sinon. */
  motif: string | null;
  /**
   * Vrai quand la date de fin est passée mais que le contrat est encore ACTIF en base : c'est à la
   * Direction de le « Marquer expiré ». Jamais vrai pour un statut déjà EXPIRE, RESILIE, TRANSFORME.
   */
  expireNonMarque: boolean;
};

/** États de signature tels que `etatSignature` les dérive (absent de la carte = jamais signé). */
export type EtatSignatureContrat = "A_SIGNER" | "SIGNE" | "A_RESIGNER";

/**
 * Le type de contrat EN CLAIR — le même libellé partout (dossier du salarié, fiche Direction,
 * « Mes contrats », attestations). Aucune valeur brute d'enum ne doit atteindre un écran.
 */
export const LIBELLE_TYPE_CONTRAT: Record<string, string> = {
  CDI: "CDI — durée indéterminée",
  CDD: "CDD — durée déterminée",
  STAGE: "Stage",
  JOURNALIER: "Journalier",
  INTERIM: "Intérim",
};

export function libelleTypeContrat(type: string): string {
  return LIBELLE_TYPE_CONTRAT[type] ?? "Autre contrat";
}

/** `JJ/MM/AAAA` d'une date métier PURE (minuit UTC) — jamais l'heure du serveur. */
export function jourMetier(d: Date): string {
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
}

/** Le plus récent d'abord : date de début, puis date de création. */
function plusRecentDabord(a: ContratClassable, b: ContratClassable): number {
  const d = new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime();
  return d !== 0 ? d : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/**
 * Classe les contrats d'UNE fiche. `maintenant` est un instant : « aujourd'hui » est son jour
 * civil à Kinshasa (UTC+1), jamais le jour UTC du serveur — sinon un CDD finissant le 28
 * paraîtrait encore en vigueur le 29 entre minuit et une heure du matin.
 *
 * « En vigueur » : statut ACTIF, date de fin nulle ou non passée, et contrat ACTIF le plus récent
 * de la fiche. La date de fin elle-même est encore un jour de contrat.
 */
export function classerContrats(
  contrats: ContratClassable[],
  etats: Map<string, EtatSignatureContrat>,
  maintenant: Date,
): Map<string, Classement> {
  const aujourdhui = jourCivilKinshasa(maintenant).getTime();
  const finPassee = (c: ContratClassable) => c.dateFin !== null && new Date(c.dateFin).getTime() < aujourdhui;
  const leDernierActif = [...contrats].filter((c) => c.statut === "ACTIF").sort(plusRecentDabord)[0] ?? null;

  const r = new Map<string, Classement>();
  for (const c of contrats) {
    const ancien = (motif: string, expireNonMarque = false): Classement => ({ categorie: "ANCIEN", motif, expireNonMarque });

    // Les gestes de la Direction priment : un CDD rompu avant son terme reste « résilié ».
    if (c.statut === "RESILIE") r.set(c.id, ancien("résilié"));
    else if (c.statut === "TRANSFORME") r.set(c.id, ancien("transformé"));
    else if (c.statut === "EXPIRE") r.set(c.id, ancien(c.dateFin ? `expiré le ${jourMetier(c.dateFin)}` : "expiré"));
    else if (finPassee(c)) r.set(c.id, ancien(`expiré le ${jourMetier(c.dateFin!)}`, true));
    else if (leDernierActif && leDernierActif.id !== c.id) {
      r.set(c.id, ancien(`remplacé par le contrat du ${jourMetier(leDernierActif.dateDebut)}`));
    } else {
      const etat = etats.get(c.id) ?? "A_SIGNER";
      r.set(c.id, { categorie: etat === "SIGNE" ? "EN_VIGUEUR" : "A_SIGNER", motif: null, expireNonMarque: false });
    }
  }
  return r;
}
