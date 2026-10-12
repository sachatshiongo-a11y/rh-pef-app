// Signalements de paie du lot d'audit du 2026-10-10 — module PUR (ni base, ni `server-only`).
// (Les absences du back-office ne sont plus signalées ici : elles sont retenues, paie-absences.ts.)
// Ils ne changent AUCUN montant : l'outil signale, la Direction tranche. Recopiés sur la ligne de
// paie (`avertissementsPaie`), donc visibles sur l'écran Paie et dans la confirmation de validation.
import type { AvertissementPaie } from "@/lib/paie-reference";
import { formaterUSD } from "@/lib/montant";
import { totalVerseUSD, type LigneNet } from "@/lib/paie-net";

/**
 * Net à payer (TOTAL VERSÉ, lib/paie-net.ts) qui ne peut pas être validé (audit du 2026-10-10) :
 * NÉGATIF (acompte et/ou échéance de prêt au-delà de ce que le mois rapporte : le bulletin dirait que
 * le salarié doit de l'argent), ou NUL parce que ces retenues absorbent tout. Un net nul SANS aucune retenue (rien gagné, rien retenu :
 * congé sans solde tout le mois) reste validable — sinon la clôture serait bloquée sans remède.
 * L'outil ne plafonne rien lui-même : la Direction réduit l'acompte ou décide du report de l'échéance.
 */
export function netNonValidable(l: LigneNet & { acompteUSD: number; retenuePretUSD: number }): boolean {
  const verse = totalVerseUSD(l);
  return verse < 0 || (verse === 0 && l.acompteUSD + l.retenuePretUSD > 0);
}

/** Négatif entre parenthèses, jamais un signe moins (convention maison, lib/montant.ts). */
export const usdSigne = (n: number) => (n < 0 ? `(${formaterUSD(n)})` : formaterUSD(n));

export function avertissementNetNonPositif(l: LigneNet & { acompteUSD: number; retenuePretUSD: number }): AvertissementPaie {
  const verse = totalVerseUSD(l);
  return {
    code: "NET_NON_POSITIF",
    message: `Total versé (net à payer) ${verse < 0 ? "négatif" : "nul"} (${usdSigne(verse)} ; acompte ${usdSigne(l.acompteUSD)}, échéance de prêt ${usdSigne(l.retenuePretUSD)}) : la validation sera refusée tant que l'acompte n'est pas réduit ou l'échéance reportée.`,
  };
}
