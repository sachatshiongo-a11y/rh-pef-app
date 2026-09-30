import "server-only";

import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { estStock } from "@/lib/espaces";
import { whereMouvements, libelleFiltre, type CleMotif } from "@/lib/filtre-mouvements";

// CARTES « ENTRÉES DE STOCK » du tableau de bord Stock (demande Direction 2026-09-30 : « somme
// totale d'entrée de stock, somme liste d'achat, somme entrée de stock par factures »).
//
// - Une ENTRÉE est un mouvement de type ENTREE. Un AJUSTEMENT d'inventaire n'en est pas une (son
//   sens n'est pas enregistré) ; les légumes frais non plus (ils n'entrent pas en stock).
// - Trois catégories qui partagent les entrées sans reste ni recouvrement, lues dans le MÊME
//   `where` que le filtre « motif » de l'écran Mouvements (`FILTRES_MOTIF`) : chaque carte compte
//   exactement la liste que son lien ouvre. Total = Liste d'achat + Factures + Autres, au centime.
// - Valeur d'une entrée = son `montantUSD` FIGÉ (une ligne de facture y porte son total, une ligne
//   de Liste d'achat son équivalent USD au taux du jour de l'achat). Jamais de conversion ici,
//   jamais d'estimation au prix catalogue : une entrée sans montant USD n'est PAS comptée zéro en
//   silence, elle est comptée à part (`nbSansValeur`) et la carte dit « partiel ».
// - Même calcul que le rapport « Achats (liste d'achat) » (`genererDonneesRapport("ACHATS")`) et,
//   pour le facturé, que le rapport « Factures fournisseurs » : une somme par mois, arrondie au centime.

/** Somme d'un ensemble d'entrées : `montant` = somme des valeurs CONNUES, arrondie au centime. */
export type SommeEntrees = { montant: number; nb: number; nbSansValeur: number };

export type IndicateursEntrees = {
  annee: number;
  mois: number;
  /** « 2026-9 » : la clé `mois` du filtre de l'écran Mouvements (liens des cartes). */
  cleMois: string;
  /** « septembre 2026 ». */
  libellePeriode: string;
  /** Total AFFICHÉ = somme des trois catégories arrondies (1 = 2 + 3 + 4 au centime, à l'écran). */
  total: SommeEntrees;
  achats: SommeEntrees;
  factures: SommeEntrees;
  autres: SommeEntrees;
  /**
   * Contrôle de la partition : toutes les entrées du mois, comptées d'un seul tenant, moins la
   * somme des trois catégories. Nul en temps normal ; non nul, une entrée échappe aux catégories
   * (ou y figure deux fois) — l'écran le dit, jamais masqué.
   */
  ecart: { montant: number; nb: number } | null;
  /** Montant des factures fournisseurs du mois (même chiffre que le rapport « Factures fournisseurs »). */
  facture: { montant: number; nb: number };
};

/** Montants de ces cartes : mêmes rôles que les autres montants du tableau de bord (espace Stock). */
export function voitIndicateursEntrees(user: { role: Role; accesStock?: boolean }): boolean {
  return estStock(user);
}

const arr = (n: number) => Math.round(n * 100) / 100;
const DEC0 = new Prisma.Decimal(0);

type Agregat = { _sum: { montantUSD: Prisma.Decimal | null }; _count: { _all: number; montantUSD: number } };
const lire = (a: Agregat) => ({ exact: a._sum.montantUSD ?? DEC0, nb: a._count._all, nbSansValeur: a._count._all - a._count.montantUSD });
const somme = (a: ReturnType<typeof lire>): SommeEntrees => ({ montant: arr(Number(a.exact)), nb: a.nb, nbSansValeur: a.nbSansValeur });

/**
 * Contrôle de la partition : toutes les entrées (comptées d'un seul tenant) moins la somme des
 * catégories, en décimal EXACT (avant tout arrondi). `null` si rien ne manque ni ne compte deux
 * fois ; sinon l'écart en nombre et en montant (positif = entrées hors catégorie, négatif =
 * entrées comptées deux fois).
 */
export function ecartDePartition(
  toutes: { exact: Prisma.Decimal; nb: number },
  parts: { exact: Prisma.Decimal; nb: number }[],
): { montant: number; nb: number } | null {
  const exact = parts.reduce((t, p) => t.plus(p.exact), DEC0);
  const nb = parts.reduce((t, p) => t + p.nb, 0);
  const montant = toutes.exact.minus(exact);
  return montant.isZero() && toutes.nb === nb ? null : { montant: arr(Number(montant)), nb: toutes.nb - nb };
}

/**
 * Les entrées de stock d'un mois (`mois` 1..12). Cinq agrégats en parallèle, aucune lecture par
 * mouvement. Les droits se vérifient AVANT l'appel (`voitIndicateursEntrees`).
 */
export async function chargerIndicateursEntrees(annee: number, mois: number): Promise<IndicateursEntrees> {
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12) throw new Error(`Mois invalide : ${annee}-${mois}.`);
  const cleMois = `${annee}-${mois}`;
  const filtre = (motif: CleMotif) => whereMouvements({ mois: cleMois, articleId: null, motif });
  const agreger = (where: Prisma.MouvementStockWhereInput) =>
    prisma.mouvementStock.aggregate({ where, _sum: { montantUSD: true }, _count: { _all: true, montantUSD: true } });

  const [toutes, achats, factures, autres, facturees] = await Promise.all([
    agreger(filtre("entrees")),
    agreger(filtre("achats")),
    agreger(filtre("factures")),
    agreger(filtre("autres")),
    // Le facturé du mois, comme le rapport « Factures fournisseurs » : par mois de facture.
    prisma.factureFournisseur.aggregate({ where: { annee, mois }, _sum: { montantUSD: true }, _count: { _all: true } }),
  ]);

  const parts = { achats: lire(achats), factures: lire(factures), autres: lire(autres) };
  const ecart = ecartDePartition(lire(toutes), [parts.achats, parts.factures, parts.autres]);
  const s = { achats: somme(parts.achats), factures: somme(parts.factures), autres: somme(parts.autres) };
  return {
    annee, mois, cleMois,
    libellePeriode: libelleFiltre({ mois: cleMois, articleId: null, motif: null }),
    total: {
      montant: arr(s.achats.montant + s.factures.montant + s.autres.montant),
      nb: s.achats.nb + s.factures.nb + s.autres.nb,
      nbSansValeur: s.achats.nbSansValeur + s.factures.nbSansValeur + s.autres.nbSansValeur,
    },
    ...s,
    ecart,
    facture: { montant: arr(Number(facturees._sum.montantUSD ?? DEC0)), nb: facturees._count._all },
  };
}
