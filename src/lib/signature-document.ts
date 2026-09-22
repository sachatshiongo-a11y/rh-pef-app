import { createHash } from "node:crypto";
import { salaireNetUSD, totalVerseUSD } from "@/lib/paie-net";

/**
 * CE QUI EST SIGNÉ — l'instantané canonique des DONNÉES d'un document, et son empreinte.
 *
 * L'empreinte porte sur les données, JAMAIS sur le PDF rendu : la refonte du bas de bulletin du
 * 2026-09-22 (trois lignes) n'a pas changé un centime, et une empreinte du PDF aurait invalidé
 * toutes les signatures d'hier sans qu'aucun montant ne bouge.
 *
 * Les montants sont des CHAÎNES à deux décimales et les dates des `AAAA-MM-JJ` : 368,5 et
 * 368,5000001 doivent donner la même empreinte, sinon une simple relecture de la paie ferait
 * « changer » un document qui n'a pas bougé.
 */
export type Instantane = Record<string, string | null>;

type Montant = number | string | { toString(): string };
const usd = (v: Montant | null | undefined): string => (v === null || v === undefined ? "0.00" : Number(v.toString()).toFixed(2));
const jour = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** JSON à clés triées : l'ordre dans lequel on a construit l'objet ne doit pas peser. */
export function canonique(o: Instantane): string {
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
}

export function empreinteDe(o: Instantane): string {
  return createHash("sha256").update(canonique(o)).digest("hex");
}

type LigneBulletin = {
  payrollRun: { mois: number; annee: number; tauxChangeUtilise: Montant };
  employee: { matricule: string };
  salBrutUSD: Montant; cnssSalarieUSD: Montant; iprCalculeUSD: Montant; transportUSD: Montant;
  primesUSD: Montant; acompteUSD: Montant; retenuePretUSD: Montant; allocFamilialeUSD: Montant;
  fraisMedicauxUSD: Montant; salNetUSD: Montant; statutPaiement: string;
};

/**
 * Le salarié signe des MONTANTS : tout ce qui les compose entre dans l'empreinte.
 *
 * Y COMPRIS LE TAUX DE CHANGE, et ce n'est pas un détail : le bulletin en francs n'est pas stocké,
 * il est CALCULÉ à l'impression (`pdf/bulletin.tsx` : `Number(run.tauxChangeUtilise)`), et
 * `rafraichirPaieDuMois` réécrit ce taux sur le run à CHAQUE ouverture de `/paie`, y compris quand
 * toutes les lignes sont validées ou payées (les statuts figés protègent les montants en dollars,
 * pas le taux). Sans le taux ici, un bulletin signé à 812 000 FC se réimprimait à 841 000 FC après
 * un simple ajustement de taux, sans jamais passer « à resigner » : mesuré, corrigé, et prouvé par
 * `signature.integration.test.ts` (« changer le TAUX DE CHANGE fait basculer le bulletin signé »).
 *
 * Conséquence ASSUMÉE : tout ajustement de taux fait basculer les bulletins signés du mois en
 * « à resigner ». C'est le comportement juste — le montant imprimé en francs a réellement changé.
 */
export function instantaneBulletin(l: LigneBulletin): Instantane {
  return {
    periode: `${l.payrollRun.annee}-${String(l.payrollRun.mois).padStart(2, "0")}`,
    tauxChange: usd(l.payrollRun.tauxChangeUtilise),
    matricule: l.employee.matricule,
    brut: usd(l.salBrutUSD),
    cnss: usd(l.cnssSalarieUSD),
    ipr: usd(l.iprCalculeUSD),
    transport: usd(l.transportUSD),
    primes: usd(l.primesUSD),
    acompte: usd(l.acompteUSD),
    retenuePret: usd(l.retenuePretUSD),
    allocFamiliale: usd(l.allocFamilialeUSD),
    fraisMedicaux: usd(l.fraisMedicauxUSD),
    salaireNet: usd(salaireNetUSD(l)),
    totalVerse: usd(totalVerseUSD(l)),
    statutPaiement: l.statutPaiement,
  };
}

type ContratSigne = {
  type: string; poste: string; dateDebut: Date; dateFin: Date | null; finPeriodeEssai: Date | null;
  salaireMensuel: Montant; devise: string; heuresHebdo: Montant; employee: { matricule: string };
};

/** Les conditions économiques du contrat — ce que `pdfAccepteObsolete` garde déjà par ailleurs. */
export function instantaneContrat(c: ContratSigne): Instantane {
  return {
    matricule: c.employee.matricule,
    type: c.type,
    poste: c.poste,
    dateDebut: jour(c.dateDebut),
    dateFin: jour(c.dateFin),
    finPeriodeEssai: jour(c.finPeriodeEssai),
    salaire: usd(c.salaireMensuel),
    devise: c.devise,
    heuresHebdo: usd(c.heuresHebdo),
  };
}

type DemandeSignee = {
  type: string; dateDebut: Date; dateFin: Date; nbJours: Montant; statut: string;
  approuveParId: string | null; employee: { matricule: string };
};

export function instantaneDemandeConge(d: DemandeSignee): Instantane {
  return {
    matricule: d.employee.matricule,
    type: d.type,
    dateDebut: jour(d.dateDebut),
    dateFin: jour(d.dateFin),
    nbJours: String(Number(d.nbJours.toString())),
    statut: d.statut,
    approuvePar: d.approuveParId,
  };
}
