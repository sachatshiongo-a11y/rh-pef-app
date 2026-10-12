import { salaireNetUSD, salaireNetCDF, totalVerseUSD, type LigneNet } from "@/lib/paie-net";
import { tauxDeLigne } from "@/lib/paie-taux";

/**
 * LIVRE DE PAIE PAR CATÉGORIE — demande Direction du 2026-09-24 : « séparer back office et
 * brigade : autre onglet pour Excel, autre page pour le PDF ».
 *
 * Module sans dépendance serveur, partagé par l'export Excel et l'export PDF : c'est ICI, et
 * nulle part ailleurs, que se décident l'ordre des parties, leur libellé et l'ordre des lignes.
 * Aucun montant n'est calculé ici autrement que par `paie-net` : on ne fait que RÉPARTIR.
 */

type Montant = number | string | { toString(): string };

/** Ce dont le livre a besoin d'une ligne de paie (Prisma fournit bien plus). */
export type LigneLivre = LigneNet & {
  salBrutUSD: Montant;
  cnssSalarieUSD: Montant;
  iprCalculeUSD: Montant;
  hsValorisee: Montant; // montant des heures supplémentaires, tel que stocké sur la ligne (USD)
  heuresSupp30: Montant;
  heuresSupp60: Montant;
  heuresSupp100: Montant;
  employee: { matricule: string; nom: string; categorie: string };
  /** Taux figé à la validation (paie-taux.ts) ; absent ou nul = taux de la paie du mois. */
  tauxChangeFige?: Montant | null;
};

/**
 * Ordre des parties : la Brigade d'abord, puis le Back-office. Ces deux parties existent
 * TOUJOURS (onglet / page « Aucun salarié » si la catégorie est vide ce mois-là). Une valeur de
 * catégorie inconnue d'ici (nouvelle valeur d'enum) obtient sa propre partie, après celles-ci,
 * dès qu'elle porte au moins une ligne — jamais fondue dans une autre.
 */
export const CATEGORIES_LIVRE = ["BRIGADE", "BACKOFFICE"] as const;

const LIBELLES: Record<string, string> = { BRIGADE: "Brigade", BACKOFFICE: "Back-office" };

export const libelleCategorie = (categorie: string) => LIBELLES[categorie] ?? categorie;

export type PartieLivre<L extends LigneLivre> = { categorie: string; libelle: string; lignes: L[] };

/** Ordre des lignes DANS une partie : par nom — le même qu'avant la séparation. */
const parNom = (a: LigneLivre, b: LigneLivre) => a.employee.nom.localeCompare(b.employee.nom);

/** Répartit les lignes du mois par catégorie, dans l'ordre des parties, chaque partie triée par nom. */
export function partiesDuLivre<L extends LigneLivre>(lignes: L[]): PartieLivre<L>[] {
  const presentes = [...new Set(lignes.map((l) => l.employee.categorie))];
  const autres = presentes.filter((c) => !(CATEGORIES_LIVRE as readonly string[]).includes(c)).sort();
  return [...CATEGORIES_LIVRE, ...autres].map((categorie) => ({
    categorie,
    libelle: libelleCategorie(categorie),
    lignes: lignes.filter((l) => l.employee.categorie === categorie).sort(parNom),
  }));
}

const n = (v: Montant): number => (typeof v === "number" ? v : Number(v.toString()));

/** Montants d'une ligne, BRUTS (non arrondis) : chaque export les arrondit comme il le faisait déjà. */
export type MontantsLivre = {
  hsHeures: number; // heures supplémentaires (30 % + 60 % + 100 %) — des heures, pas un montant
  hsUSD: number;
  brutUSD: number;
  cnssUSD: number;
  iprUSD: number;
  transportUSD: number;
  netUSD: number;
  netCDF: number;
  verseUSD: number;
  verseCDF: number;
};

/**
 * Francs au taux du BULLETIN : le taux figé à la validation pour une ligne validée ou payée, sinon
 * celui de la paie du mois (`taux`, `run.tauxChangeUtilise`) — `tauxDeLigne`, décision Direction
 * 2026-10-12. Jamais déduit de salNetCDF / salNetUSD ; versé CDF au même taux que le net CDF.
 */
export function montantsDeLigne(l: LigneLivre, tauxPaie: number): MontantsLivre {
  const taux = tauxDeLigne(l, { tauxChangeUtilise: tauxPaie });
  return {
    hsHeures: n(l.heuresSupp30) + n(l.heuresSupp60) + n(l.heuresSupp100),
    hsUSD: n(l.hsValorisee),
    brutUSD: n(l.salBrutUSD),
    cnssUSD: n(l.cnssSalarieUSD),
    iprUSD: n(l.iprCalculeUSD),
    transportUSD: n(l.transportUSD),
    netUSD: salaireNetUSD(l),
    netCDF: salaireNetCDF(l, taux),
    verseUSD: totalVerseUSD(l),
    verseCDF: totalVerseUSD(l) * taux,
  };
}

/** Somme, champ par champ, des montants BRUTS d'un ensemble de lignes. */
export function totauxDuLivre(lignes: LigneLivre[], taux: number): MontantsLivre {
  const t: MontantsLivre = { hsHeures: 0, hsUSD: 0, brutUSD: 0, cnssUSD: 0, iprUSD: 0, transportUSD: 0, netUSD: 0, netCDF: 0, verseUSD: 0, verseCDF: 0 };
  for (const l of lignes) {
    const m = montantsDeLigne(l, taux);
    for (const k of Object.keys(t) as (keyof MontantsLivre)[]) t[k] += m[k];
  }
  return t;
}

/**
 * La ligne porte-t-elle des heures supplémentaires ce mois-ci ? Heures OU montant : un montant sans
 * heures (ou l'inverse) reste une anomalie à MONTRER, jamais à masquer.
 */
export function aDesHeuresSupp(l: LigneLivre): boolean {
  const m = montantsDeLigne(l, 0);
  return m.hsHeures !== 0 || m.hsUSD !== 0;
}
