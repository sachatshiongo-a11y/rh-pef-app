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

// Plus de colonne « Cat. » : la partie porte déjà le nom de sa catégorie (relecture 2026-09-24).
// La place rendue va au NOM, qui ne doit jamais se couper (« Luyin-dula ») ni passer à la ligne.

// Sans heures supp. : 10+20+10+9+9+9+11+12+10 = 100.
const COLONNES: Colonne[] = [
  { header: "Matricule", width: "10%" },
  { header: "Nom", width: "20%" },
  { header: "Brut $", width: "10%", align: "right" },
  { header: "Transport $", width: "9%", align: "right" },
  { header: "CNSS $", width: "9%", align: "right" },
  { header: "IPR $", width: "9%", align: "right" },
  { header: "Salaire net $", width: "11%", align: "right" },
  { header: "Sal. net CDF", width: "12%", align: "right" },
  { header: "Versé $", width: "10%", align: "right" },
];

/** Colonne « Heures supp. $ » (Direction, 2026-09-24) : juste avant le brut, qui la contient. */
export const ENTETE_HS_PDF = "Heures supp. $";

// Avec heures supp. : 9+17+13+9+8+8+8+9+10+9 = 100. La colonne d'heures supp. tient
// « 1 234,56 » et « 123,5 h » sur UNE ligne ; le nom garde plus de 16 %.
const COLONNES_HS: Colonne[] = [
  { header: "Matricule", width: "9%" },
  { header: "Nom", width: "17%" },
  { header: ENTETE_HS_PDF, width: "13%", align: "right" },
  { header: "Brut $", width: "9%", align: "right" },
  { header: "Transport $", width: "8%", align: "right" },
  { header: "CNSS $", width: "8%", align: "right" },
  { header: "IPR $", width: "8%", align: "right" },
  { header: "Salaire net $", width: "9%", align: "right" },
  { header: "Sal. net CDF", width: "10%", align: "right" },
  { header: "Versé $", width: "9%", align: "right" },
];

// Récapitulatif : 18+8+10+9+9+9+11+14+12 = 100.
const COLONNES_RECAP: Colonne[] = [
  { header: "Catégorie", width: "18%" },
  { header: "Salariés", width: "8%", align: "right" },
  { header: "Brut $", width: "10%", align: "right" },
  { header: "Transport $", width: "9%", align: "right" },
  { header: "CNSS $", width: "9%", align: "right" },
  { header: "IPR $", width: "9%", align: "right" },
  { header: "Salaire net $", width: "11%", align: "right" },
  { header: "Sal. net CDF", width: "14%", align: "right" },
  { header: "Versé $", width: "12%", align: "right" },
];

// Récapitulatif avec heures supp. : 13+7+13+9+9+8+8+10+12+11 = 100.
const COLONNES_RECAP_HS: Colonne[] = [
  { header: "Catégorie", width: "13%" },
  { header: "Salariés", width: "7%", align: "right" },
  { header: ENTETE_HS_PDF, width: "13%", align: "right" },
  { header: "Brut $", width: "9%", align: "right" },
  { header: "Transport $", width: "9%", align: "right" },
  { header: "CNSS $", width: "8%", align: "right" },
  { header: "IPR $", width: "8%", align: "right" },
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

const CHAMPS_CDF = new Set<keyof MontantsLivre>(["netCDF", "verseCDF"]);
/** Chaque montant arrondi comme il s'affiche : au franc en CDF, au centième ailleurs ($, heures). */
const arrondiAffiche = (m: MontantsLivre): MontantsLivre =>
  Object.fromEntries(
    (Object.keys(m) as (keyof MontantsLivre)[]).map((k) => [k, CHAMPS_CDF.has(k) ? Math.round(m[k]) : Math.round(m[k] * 100) / 100]),
  ) as MontantsLivre;
const sommeMontants = (ms: MontantsLivre[]): MontantsLivre => {
  const t = { ...ms[0] };
  for (const k of Object.keys(t) as (keyof MontantsLivre)[]) t[k] = ms.reduce((s, m) => s + m[k], 0);
  return t;
};

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
      ...montantsAffiches(montantsDeLigne(l, taux), avecHS),
    ]);
    const vide = rows.length === 0;
    if (vide) rows.push([AUCUN_SALARIE_PDF]);
    rows.push(["TOTAL", salaries(p.lignes.length), ...montantsAffiches(totauxDuLivre(p.lignes, taux), avecHS)]);
    return {
      titre: t(`${p.libelle} — ${salaries(p.lignes.length)}`),
      colonnes: avecHS ? COLONNES_HS : COLONNES,
      lignes: rows,
      totalDerniereLigne: true,
      sectionRows: vide ? [0] : undefined,
    };
  });

  // Total général = somme des totaux de catégorie TELS QU'AFFICHÉS (centime en $, franc en CDF) :
  // la colonne s'additionne à l'œil. Sommer les lignes brutes puis arrondir pouvait donner un franc
  // d'écart avec la somme des deux lignes du dessus (relecture 2026-09-24).
  // Les heures supp. y figurent (par catégorie) dès qu'un salarié du mois en a.
  const recapHS = lignes.some(aDesHeuresSupp);
  const totauxCategories = parties.map((p) => arrondiAffiche(totauxDuLivre(p.lignes, taux)));
  const general = arrondiAffiche(sommeMontants(totauxCategories));
  const recap: PartieTableau = {
    titre: TITRE_RECAP_PDF,
    colonnes: recapHS ? COLONNES_RECAP_HS : COLONNES_RECAP,
    lignes: [
      ...parties.map((p, i) => [t(p.libelle), String(p.lignes.length), ...montantsAffiches(totauxCategories[i], recapHS)]),
      ["TOTAL GÉNÉRAL", String(lignes.length), ...montantsAffiches(general, recapHS)],
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
