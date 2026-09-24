import type { PaymentStatus } from "@prisma/client";
import { TableauxParPartieDocument, type Cellule, type Colonne, type PartieTableau } from "./tableau";
import { formaterNombre, normaliserEspaces } from "@/lib/montant";
import { LIBELLE_STATUT } from "@/lib/paie-etats";
import { aDesHeuresSupp, montantsDeLigne, partiesDuLivre, totauxDuLivre, type LigneLivre, type MontantsLivre } from "@/lib/livre-paie";

// Tout nombre passe par formaterNombre (espaces normalisées) : l'espace fine insécable de fr-FR
// n'existe pas dans Optima et barrerait les montants (voir src/lib/montant.ts).
const usd = (n: number) => formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cdf = (n: number) => formaterNombre(Math.round(n));
const heures = (n: number) => `${formaterNombre(n, { maximumFractionDigits: 2 })} h`;
const t = normaliserEspaces;

export const AUCUN_SALARIE_PDF = "Aucun salarié dans cette catégorie ce mois-ci.";
export const TITRE_RECAP_PDF = "Récapitulatif";

// Largeurs (%) : 10+16+8+9+9+9+8+11+10+10 = 100 — colonnes d'avant la séparation, inchangées
// pour une partie SANS heures supplémentaires.
const COLONNES: Colonne[] = [
  { header: "Matricule", width: "10%" },
  { header: "Nom", width: "16%" },
  { header: "Cat.", width: "8%" },
  { header: "Brut $", width: "9%", align: "right" },
  { header: "Transport $", width: "9%", align: "right" },
  { header: "CNSS $", width: "9%", align: "right" },
  { header: "IPR $", width: "8%", align: "right" },
  { header: "Salaire net $", width: "11%", align: "right" },
  { header: "Sal. net CDF", width: "10%", align: "right" },
  { header: "Versé $", width: "10%", align: "right" },
];

/** Colonne « Heures supp. $ » (Direction, 2026-09-24) : juste avant le brut, qui la contient. */
export const ENTETE_HS_PDF = "Heures supp. $";

// Avec heures supp. : 9+13+7+9+9+8+8+8+10+10+9 = 100 (le nom et les petites colonnes cèdent la place).
const COLONNES_HS: Colonne[] = [
  { header: "Matricule", width: "9%" },
  { header: "Nom", width: "13%" },
  { header: "Cat.", width: "7%" },
  { header: ENTETE_HS_PDF, width: "9%", align: "right" },
  { header: "Brut $", width: "9%", align: "right" },
  { header: "Transport $", width: "8%", align: "right" },
  { header: "CNSS $", width: "8%", align: "right" },
  { header: "IPR $", width: "8%", align: "right" },
  { header: "Salaire net $", width: "10%", align: "right" },
  { header: "Sal. net CDF", width: "10%", align: "right" },
  { header: "Versé $", width: "9%", align: "right" },
];

// Récapitulatif : 18+8+9+9+9+8+11+14+14 = 100.
const COLONNES_RECAP: Colonne[] = [
  { header: "Catégorie", width: "18%" },
  { header: "Salariés", width: "8%", align: "right" },
  { header: "Brut $", width: "9%", align: "right" },
  { header: "Transport $", width: "9%", align: "right" },
  { header: "CNSS $", width: "9%", align: "right" },
  { header: "IPR $", width: "8%", align: "right" },
  { header: "Salaire net $", width: "11%", align: "right" },
  { header: "Sal. net CDF", width: "14%", align: "right" },
  { header: "Versé $", width: "14%", align: "right" },
];

// Récapitulatif avec heures supp. : 13+7+10+10+9+9+9+10+12+11 = 100.
const COLONNES_RECAP_HS: Colonne[] = [
  { header: "Catégorie", width: "13%" },
  { header: "Salariés", width: "7%", align: "right" },
  { header: ENTETE_HS_PDF, width: "10%", align: "right" },
  { header: "Brut $", width: "10%", align: "right" },
  { header: "Transport $", width: "9%", align: "right" },
  { header: "CNSS $", width: "9%", align: "right" },
  { header: "IPR $", width: "9%", align: "right" },
  { header: "Salaire net $", width: "10%", align: "right" },
  { header: "Sal. net CDF", width: "12%", align: "right" },
  { header: "Versé $", width: "11%", align: "right" },
];

/**
 * Montants affichés ; la cellule d'heures supp. seulement si demandée : le montant, puis les heures
 * en petit quand il y en a (« 0,00 » seul sinon, comme les colonnes voisines).
 */
const montantsAffiches = (m: MontantsLivre, avecHS: boolean): Cellule[] => [
  ...(avecHS ? [{ texte: usd(m.hsUSD), note: m.hsHeures !== 0 ? heures(m.hsHeures) : undefined }] : []),
  usd(m.brutUSD),
  usd(m.transportUSD),
  usd(m.cnssUSD),
  usd(m.iprUSD),
  usd(m.netUSD),
  cdf(m.netCDF),
  usd(m.verseUSD),
];

const salaries = (n: number) => `${n} salarié(s)`;

type LignePdf = LigneLivre & { statutPaiement: PaymentStatus };

/**
 * Les parties du livre (une par catégorie, puis le récapitulatif), prêtes à rendre. Séparées du
 * document pour que les tests relisent les montants EXACTS affichés, sans analyser le PDF.
 */
export function partiesDuLivrePdf(lignes: LignePdf[], taux: number): PartieTableau[] {
  const parties = partiesDuLivre(lignes);

  const pagesCategorie: PartieTableau[] = parties.map((p) => {
    // La colonne n'apparaît QUE si un salarié de la partie a des heures supp. ce mois-ci.
    const avecHS = p.lignes.some(aDesHeuresSupp);
    const rows: Cellule[][] = p.lignes.map((l) => [
      t(l.employee.matricule),
      t(l.employee.nom),
      p.categorie === "BRIGADE" ? "Brigade" : p.categorie === "BACKOFFICE" ? "Back-off." : t(p.libelle),
      ...montantsAffiches(montantsDeLigne(l, taux), avecHS),
    ]);
    const vide = rows.length === 0;
    if (vide) rows.push([AUCUN_SALARIE_PDF]);
    rows.push(["TOTAL", salaries(p.lignes.length), "", ...montantsAffiches(totauxDuLivre(p.lignes, taux), avecHS)]);
    return {
      titre: t(`${p.libelle} — ${salaries(p.lignes.length)}`),
      colonnes: avecHS ? COLONNES_HS : COLONNES,
      lignes: rows,
      totalDerniereLigne: true,
      sectionRows: vide ? [0] : undefined,
    };
  });

  // Total général : sur TOUTES les lignes du mois, comme le TOTAL unique d'avant la séparation.
  // Les heures supp. y figurent (par catégorie) dès qu'un salarié du mois en a.
  const recapHS = lignes.some(aDesHeuresSupp);
  const recap: PartieTableau = {
    titre: TITRE_RECAP_PDF,
    colonnes: recapHS ? COLONNES_RECAP_HS : COLONNES_RECAP,
    lignes: [
      ...parties.map((p) => [t(p.libelle), String(p.lignes.length), ...montantsAffiches(totauxDuLivre(p.lignes, taux), recapHS)]),
      ["TOTAL GÉNÉRAL", String(lignes.length), ...montantsAffiches(totauxDuLivre(lignes, taux), recapHS)],
    ],
    totalDerniereLigne: true,
  };
  return [...pagesCategorie, recap];
}

/**
 * Livre de paie PDF : la Brigade sur ses pages, puis le Back-office à partir d'une NOUVELLE page
 * (et toute autre catégorie présente, chacune sur les siennes), chaque partie avec son titre, son
 * tableau et sa ligne TOTAL ; enfin une page « Récapitulatif » (totaux par catégorie + total
 * général). Mêmes colonnes et mêmes montants qu'avant la séparation (2026-09-24), plus la colonne
 * « Heures supp. $ » dans une partie qui en compte.
 */
export function LivrePaieDocument({ lignes, taux, periode }: { lignes: LignePdf[]; taux: number; periode: string }) {
  const statuts = lignes.map((l) => LIBELLE_STATUT[l.statutPaiement]).filter((v, i, a) => a.indexOf(v) === i);
  return TableauxParPartieDocument({
    titre: "Livre de paie",
    sousTitre: t(periode),
    parties: partiesDuLivrePdf(lignes, taux),
    pied: t(`Statuts : ${statuts.join(" · ")}. Document interne — TOLYA SARL.`),
  });
}
