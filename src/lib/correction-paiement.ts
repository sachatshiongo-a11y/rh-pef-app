import type { ModePaiement } from "@prisma/client";
import { lireDateVersementPaie } from "@/lib/date-paiement";
import { MOIS_FR } from "@/lib/dates-fr";

// CORRIGER LE PAIEMENT D'UN BULLETIN DÉJÀ PAYÉ (Direction, 2026-10-12) : la date de versement et le moyen de
// paiement, de n'importe quel mois, et RIEN d'autre. Module pur (ni base, ni `server-only`) : les règles de lecture
// et les textes de la trace, testables sans Postgres ; l'écriture est dans `app/(app)/paie/correction-paiement-actions.ts`.
//
// Ce qui ne bouge JAMAIS dans une correction : l'état (le bulletin reste « Payé »), les montants, le taux figé
// (`tauxChangeFige` / `tauxDeLigne`), les totaux du mois et les déclarations. La signature électronique non plus :
// l'empreinte d'un bulletin (`instantaneBulletin`, lib/signature-document.ts) ne contient NI la date de versement
// NI le moyen de paiement — une correction ne rend donc jamais un bulletin « à resigner » (preuve : signature-document.test.ts).

/** Les moyens de paiement d'un versement de salaire — la liste de l'écran « À valider » (bulletins à payer), mot pour mot. */
export const MODES_PAIEMENT: readonly { value: ModePaiement; label: string }[] = [
  { value: "ESPECES", label: "Espèces" },
  { value: "VIREMENT", label: "Virement" },
  { value: "MOBILE_MONEY", label: "Mobile Money" },
  { value: "CHEQUE", label: "Chèque" },
  { value: "AUTRE", label: "Autre" },
];

/** Longueur maximale du motif (une phrase, pas un dossier). */
export const MOTIF_CORRECTION_MAX = 300;

export function libelleModePaiement(mode: ModePaiement | null | undefined): string {
  return MODES_PAIEMENT.find((m) => m.value === mode)?.label ?? "non renseigné";
}

/** `2026-10-05` → `05/10/2026`. */
export function jourFrancais(jourISO: string): string {
  return jourISO.slice(0, 10).split("-").reverse().join("/");
}

/** Le moyen de paiement saisi : l'un des cinq, sinon refus lisible. */
export function lireModeCorrection(brut: unknown): ModePaiement {
  const v = String(brut ?? "").trim();
  const trouve = MODES_PAIEMENT.find((m) => m.value === v);
  if (!trouve) throw new Error("Choisissez le moyen de paiement (espèces, virement, Mobile Money, chèque ou autre).");
  return trouve.value;
}

/** Le motif : OBLIGATOIRE (une correction sans raison n'est pas une trace), borné. */
export function lireMotifCorrection(brut: unknown): string {
  const motif = String(brut ?? "").replace(/\s+/g, " ").trim();
  if (!motif) throw new Error("Le motif de la correction est obligatoire.");
  if (motif.length > MOTIF_CORRECTION_MAX) throw new Error(`Le motif est trop long (${MOTIF_CORRECTION_MAX} caractères au plus).`);
  return motif;
}

/**
 * La date de versement corrigée : OBLIGATOIRE (un champ vide ne devient pas « aujourd'hui » — une correction ne
 * change jamais de jour sans que personne l'ait demandé), puis les MÊMES contrôles que « Marquer payé »
 * (`lireDateVersementPaie`) : illisible → refus, dans le futur → refus, avant le 1er jour du mois de la paie → refus.
 * Renvoie `YYYY-MM-DD`.
 */
export function lireDateCorrection(saisie: unknown, paie: { mois: number; annee: number }, maintenant: Date = new Date()): string {
  const s = String(saisie ?? "").trim();
  if (!s) throw new Error("La date de versement est obligatoire.");
  return lireDateVersementPaie(s, paie, maintenant);
}

export type PaiementLu = { jour: string | null; mode: ModePaiement | null };

/** Date et moyen d'une ligne PAYÉE, tels que stockés (`datePaiement` : date pure, minuit UTC). */
export function paiementDeLigne(l: { datePaiement: Date | null; modePaiement: ModePaiement | null }): PaiementLu {
  return { jour: l.datePaiement ? l.datePaiement.toISOString().slice(0, 10) : null, mode: l.modePaiement };
}

export type ChangementPaiement = { dateChangee: boolean; modeChange: boolean };

export function changementPaiement(avant: PaiementLu, apres: { jour: string; mode: ModePaiement }): ChangementPaiement {
  return { dateChangee: avant.jour !== apres.jour, modeChange: avant.mode !== apres.mode };
}

const texteJour = (jour: string | null) => (jour ? jourFrancais(jour) : "non renseignée");

/** « 05/10/2026 · Espèces » — une valeur, avant ou après, telle qu'elle se lit dans le journal d'audit. */
export function texteValeurPaiement(p: { jour: string | null; mode: ModePaiement | null }): string {
  return `${texteJour(p.jour)} · ${libelleModePaiement(p.mode)}`;
}

/** Ce qui change, en une phrase : « date 05/10/2026 → 07/10/2026 ; moyen Espèces → Virement ». */
export function resumeCorrection(avant: PaiementLu, apres: { jour: string; mode: ModePaiement }): string {
  const c = changementPaiement(avant, apres);
  const parties: string[] = [];
  if (c.dateChangee) parties.push(`date ${texteJour(avant.jour)} → ${texteJour(apres.jour)}`);
  if (c.modeChange) parties.push(`moyen ${libelleModePaiement(avant.mode)} → ${libelleModePaiement(apres.mode)}`);
  return parties.join(" ; ");
}

/** Commentaire de la ligne d'historique du bulletin (`TransitionPaie` Payé → Payé). */
export function commentaireCorrection(avant: PaiementLu, apres: { jour: string; mode: ModePaiement }, motif: string): string {
  return `Correction du paiement : ${resumeCorrection(avant, apres)}. Motif : ${motif}`;
}

/** Une correction qui ne change rien n'est pas une correction. */
export const MESSAGE_RIEN_A_CORRIGER = "Rien à corriger : la date et le moyen de paiement sont déjà ceux-là.";

export const MESSAGE_CORRECTION_BULLETIN_NON_PAYE = "Seul un bulletin payé se corrige ici : rechargez la page.";

/** Mois civil (annee, mois) d'un jour `YYYY-MM-DD`. */
export function moisDuJour(jourISO: string): { annee: number; mois: number } {
  return { annee: Number(jourISO.slice(0, 4)), mois: Number(jourISO.slice(5, 7)) };
}

/**
 * Refus : la correction déplacerait le paiement d'un mois de l'EXPLOITATION à un autre alors que l'un des deux
 * est clôturé. Le rapprochement de l'Exploitation lit la date de versement (« paie versée du mois ») : le
 * changer ferait bouger, sans bruit, le chiffre d'un mois clos.
 */
export function messageCorrectionMoisExploitationClos(clos: { annee: number; mois: number }, avant: string | null, apres: string): string {
  const libelle = `${MOIS_FR[clos.mois - 1]} ${clos.annee}`;
  return `Le mois de ${libelle} est clôturé dans l'Exploitation, et cette date (${texteJour(avant)} → ${texteJour(apres)}) ferait passer ce paiement ${avant ? "d'un mois à l'autre" : "dans un autre mois"} : la paie versée d'un mois clos changerait. Choisissez une date du même mois, ou rouvrez d'abord le mois (Exploitation → Clôture mensuelle).`;
}
