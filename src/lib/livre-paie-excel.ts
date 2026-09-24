import "server-only";
import { classeurExcel, colonnesATotaliser, type FeuilleExcel } from "@/lib/export-excel";
import { LIBELLE_STATUT } from "@/lib/paie-etats";
import type { PaymentStatus } from "@prisma/client";
import { montantsDeLigne, partiesDuLivre, type LigneLivre } from "@/lib/livre-paie";

/**
 * En-tête d'une feuille de catégorie — colonnes du livre d'avant la séparation, plus les heures
 * supp., moins « Catégorie » (redondante : l'onglet porte le nom de la catégorie).
 */
export const ENTETE_LIVRE_EXCEL = [
  "Matricule",
  "Nom",
  // Heures supplémentaires (Direction, 2026-09-24) : juste avant le brut, qui les contient.
  "Heures supp. (h)",
  "Heures supp. $",
  "Salaire brut $",
  "CNSS salarié $",
  "IPR $",
  "Transport $",
  "Salaire net $",
  "Salaire net CDF",
  "Total versé $",
  "Total versé CDF",
  "Statut",
];

export const MESSAGE_AUCUN_SALARIE = "Aucun salarié dans cette catégorie ce mois-ci.";
export const NOM_ONGLET_RECAP = "Récapitulatif";

type LigneExcel = LigneLivre & { statutPaiement: PaymentStatus };

/** Une ligne du livre, arrondie comme avant (centime en $, franc en CDF). */
function rangee(l: LigneExcel, taux: number): (string | number)[] {
  const m = montantsDeLigne(l, taux);
  return [
    l.employee.matricule,
    l.employee.nom,
    Number(m.hsHeures.toFixed(2)),
    Number(m.hsUSD.toFixed(2)),
    Number(m.brutUSD.toFixed(2)),
    Number(m.cnssUSD.toFixed(2)),
    Number(m.iprUSD.toFixed(2)),
    Number(m.transportUSD.toFixed(2)),
    Number(m.netUSD.toFixed(2)),
    Number(m.netCDF.toFixed(0)),
    Number(m.verseUSD.toFixed(2)),
    Number(m.verseCDF.toFixed(0)),
    LIBELLE_STATUT[l.statutPaiement],
  ];
}

/** Même règle que la ligne « Total » de `classeurExcel` : somme puis arrondi au centime. */
function somme(rangees: (string | number)[][], ci: number): number {
  let s = 0;
  for (const r of rangees) { const v = Number(r[ci]); if (Number.isFinite(v)) s += v; }
  return Math.round(s * 100) / 100;
}

/**
 * Livre de paie Excel : un onglet par catégorie (Brigade, puis Back-office, puis toute autre
 * valeur présente), chacun avec ses lignes, sa ligne « Total » et son autofiltre ; puis un
 * onglet « Récapitulatif » dont chaque ligne REPREND le total de l'onglet correspondant.
 */
export async function classeurLivrePaie(opts: { lignes: LigneExcel[]; taux: number; periode: string }): Promise<Buffer> {
  const { lignes, taux, periode } = opts;
  // Montants ($, CDF) et quantités (heures) : jamais le matricule, le nom ou le statut.
  const colsTotal = colonnesATotaliser(ENTETE_LIVRE_EXCEL);
  const parties = partiesDuLivre(lignes).map((p) => ({ ...p, rangees: p.lignes.map((l) => rangee(l, taux)) }));

  const feuilles: FeuilleExcel[] = parties.map((p) => ({
    nom: p.libelle,
    titre: `Livre de paie — ${p.libelle}`,
    entete: ENTETE_LIVRE_EXCEL,
    lignes: p.rangees,
    // Une ligne « Total » en bas de chaque colonne de montant (Direction, 2026-09-23) et d'heures.
    totauxCols: colsTotal,
    messageVide: MESSAGE_AUCUN_SALARIE,
    autofiltre: true,
  }));

  // Récapitulatif : chaque ligne porte EXACTEMENT le total de l'onglet (même fonction de somme
  // sur les mêmes rangées) ; « Total général » additionne ces lignes.
  const enteteRecap = ["Catégorie", "Salariés", ...colsTotal.map((ci) => ENTETE_LIVRE_EXCEL[ci])];
  feuilles.push({
    nom: NOM_ONGLET_RECAP,
    titre: "Livre de paie — Récapitulatif",
    entete: enteteRecap,
    lignes: parties.map((p) => [p.libelle, p.rangees.length, ...colsTotal.map((ci) => somme(p.rangees, ci))]),
    totauxCols: enteteRecap.map((_, i) => i).slice(1),
    libelleTotal: "Total général",
    // Pas d'autofiltre : trois lignes, dont un total qu'un tri déplacerait.
  });

  return classeurExcel({ titre: "Livre de paie", periode, feuilles });
}
