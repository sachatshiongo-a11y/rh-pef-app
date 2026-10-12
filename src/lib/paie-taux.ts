/**
 * TAUX DE CHANGE D'UNE LIGNE DE PAIE — décision de la Direction du 2026-10-12 (5) : un bulletin
 * VALIDÉ ou PAYÉ s'imprime, se déclare et se réimprime au taux ENREGISTRÉ À SA VALIDATION
 * (`PayrollLine.tauxChangeFige`), plus jamais au taux du jour que le recalcul du mois réécrit sur
 * la paie (`PayrollRun.tauxChangeUtilise`, paie-refresh.ts). Une ligne non validée suit le taux de
 * la paie du mois (bulletin PROVISOIRE).
 *
 * Ligne figée AVANT l'existence de la colonne (NULL) : le taux de la paie du mois, comme avant —
 * jamais un taux deviné. Sa reprise est une décision de la Direction (requête dans le rapport du lot).
 *
 * Module PUR : écrans, exports, documents et déclarations lisent le taux ici, et nulle part ailleurs.
 */
import { formaterNombre } from "@/lib/montant";

/** « 1 $ = 2 800 CDF », ou les taux des bulletins s'ils diffèrent (chacun au taux de sa validation). */
export function libelleTauxPaie(taux: number[]): string {
  const uniques = [...new Set(taux)].sort((a, b) => a - b).map((t) => `${formaterNombre(t, { maximumFractionDigits: 2 })} CDF`);
  if (uniques.length <= 1) return `1 $ = ${uniques[0] ?? "—"}`;
  return `1 $ = ${uniques.join(" ou ")} selon le bulletin (chaque bulletin validé au taux de sa validation)`;
}

type Montant = number | string | { toString(): string } | null | undefined;

export function tauxDeLigne(ligne: { tauxChangeFige?: Montant }, run: { tauxChangeUtilise: Montant }): number {
  const fige = ligne.tauxChangeFige;
  if (fige !== null && fige !== undefined && Number(fige.toString()) > 0) return Number(fige.toString());
  return Number((run.tauxChangeUtilise ?? 0).toString());
}
