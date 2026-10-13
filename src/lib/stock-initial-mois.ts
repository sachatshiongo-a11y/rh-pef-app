// STOCK INITIAL DU MOIS — le stock d'un article au 1er du mois, à 00 h, jour civil de Kinshasa.
// Module PUR (ni base, ni React) : le chargeur est `stock-initial-mois-donnees.ts`.
//
// RÈGLE (demande de la Direction, 13/10/2026) :
//
//     stock initial = stock de FIN − entrées + sorties − ajustements nets
//
// où « stock de fin » est le stock ACTUEL (mois non clôturé) ou l'instantané figé (mois clôturé), et où les
// mouvements retirés sont TOUS ceux datés à partir du 1er du mois, mois suivants compris. Pour un mois clôturé,
// l'instantané a été pris à l'instant de la clôture (`ClotureStock.createdAt`), pas à minuit : seuls les
// mouvements DÉJÀ ENREGISTRÉS à cet instant y sont comptés (le chargeur filtre sur `createdAt`).
//
// CE QUE CHAQUE MOUVEMENT FAIT AU STOCK AUJOURD'HUI (relevé dans le code, 13/10/2026) :
//  - ENTREE  : +quantité   (`entrerEnStockTx`, `variationsStockTx`) ; supprimée : −quantité.
//  - SORTIE  : −quantité   (`sortirDuStockTx`) ;                       supprimée : +quantité.
//  - AJUSTEMENT : créé UNIQUEMENT par un comptage (`ecrireComptageTx`) avec quantité = |écart|, SANS SENS : le
//    stock est POSÉ à la quantité comptée. Le sens se lit dans `LigneComptage.ecart` (signé), qui est aussi le
//    changement réel de stock (comptage direct : physique − théorique relu sous verrou ; comptage validé plus
//    tard : stock actuel + écart). Le chargeur apparie les deux (voir `resoudreAjustements`) ; sans appariement
//    sûr, le stock initial est INCONNU (« — »), jamais deviné.
//  - Import d'INVENTAIRE : pose le stock en ABSOLU et n'écrit que des mouvements de JOURNAL (sans effet sur le
//    stock). Un article touché par un tel import à partir du 1er est donc NON reconstituable : « — ».
//  - Correction des stocks négatifs : une ENTREE du manque (comptée comme toute entrée).
//  - Fusion d'articles : les mouvements du doublon passent à l'article conservé avec son stock : cohérent.
//
// JAMAIS 0 POUR UNE VALEUR INCONNUE : trois états. `ok` (une quantité), `absent` (l'article n'existait pas au 1er :
// créé en cours de mois, sans mouvement daté d'avant — le zéro dirait « il y en avait 0 », ce qui est inventé),
// `inconnu` (le calcul n'est pas fiable, avec la raison).
import Decimal from "decimal.js";

export type Quantite = number | string;

/** Kinshasa est à UTC+1 toute l'année (pas d'heure d'été). */
const DECALAGE_KINSHASA_MS = 3_600_000;

/** Le 1er du mois à 00 h 00, heure de Kinshasa — un INSTANT (= 23 h 00 UTC la veille). Sert à comparer `createdAt`. */
export function debutMoisKinshasa(annee: number, mois: number): Date {
  return new Date(Date.UTC(annee, mois - 1, 1) - DECALAGE_KINSHASA_MS);
}
/** Le 1er du mois comme date PURE (minuit UTC, colonne `@db.Date` de `MouvementStock.date`). */
export function jourDebutMois(annee: number, mois: number): Date {
  return new Date(Date.UTC(annee, mois - 1, 1));
}
/** Le 1er du mois SUIVANT, date pure (borne haute exclue d'un mois). */
export function jourDebutMoisSuivant(annee: number, mois: number): Date {
  return new Date(Date.UTC(annee, mois, 1));
}
export function moisPrecedent(annee: number, mois: number): { annee: number; mois: number } {
  return mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 };
}

const dec = (q: Quantite | Decimal) => new Decimal(q as Decimal.Value);
const arrondi = (d: Decimal) => d.toDecimalPlaces(3).toNumber();

// ── Mouvements agrégés ─────────────────────────────────────────────────────────

/** Ajustements d'une fenêtre : leur nombre, et leur effet net SIGNÉ (null = le sens n'a pas pu être établi). */
export type Ajustements = { nb: number; net: Quantite | null };
export type MouvementsAgreges = { entrees: Quantite; sorties: Quantite; ajustements: Ajustements };
export const SANS_MOUVEMENT: MouvementsAgreges = { entrees: 0, sorties: 0, ajustements: { nb: 0, net: 0 } };

/** Somme de deux fenêtres (le mois, puis ce qui est daté après lui) ; un net inconnu reste inconnu. */
export function additionner(a: MouvementsAgreges, b: MouvementsAgreges): MouvementsAgreges {
  return {
    entrees: dec(a.entrees).plus(dec(b.entrees)).toString(),
    sorties: dec(a.sorties).plus(dec(b.sorties)).toString(),
    ajustements: {
      nb: a.ajustements.nb + b.ajustements.nb,
      net: a.ajustements.net === null || b.ajustements.net === null ? null : dec(a.ajustements.net).plus(dec(b.ajustements.net)).toString(),
    },
  };
}

/**
 * Sens des ajustements d'un article dans une fenêtre. Les mouvements d'AJUSTEMENT n'ont pas de sens ; les lignes de
 * comptage en ont un. Le sens n'est établi QUE si les deux listes se correspondent exactement (mêmes valeurs absolues,
 * une à une) : un ajustement supprimé à la main (son effet reste, la ligne disparaît) ou un comptage plus ancien
 * mal daté ferait sinon une somme fausse. Pas d'appariement sûr : `net` est null.
 */
export function resoudreAjustements(mouvements: readonly { quantite: Quantite }[], lignes: readonly { ecart: Quantite }[]): Ajustements {
  const nb = mouvements.length;
  if (nb === 0) return { nb: 0, net: 0 };
  const cle = (q: Quantite) => dec(q).abs().toDecimalPlaces(3).toFixed(3);
  const vus = mouvements.map((m) => cle(m.quantite)).sort();
  const lus = lignes.map((l) => cle(l.ecart)).sort();
  if (vus.length !== lus.length || vus.some((v, i) => v !== lus[i])) return { nb, net: null };
  return { nb, net: lignes.reduce((t, l) => t.plus(dec(l.ecart)), new Decimal(0)).toDecimalPlaces(3).toString() };
}

// ── Le calcul ───────────────────────────────────────────────────────────────────

export type StockInitial =
  | { etat: "ok"; quantite: number }
  | { etat: "absent"; raison: string }
  | { etat: "inconnu"; raison: string };

export type EntreeCalcul = {
  /** Stock de fin : actuel (mois non clôturé) ou figé (clôturé) ; null = aucun stock connu pour l'article. */
  stockFin: Quantite | null;
  /** TOUS les mouvements datés à partir du 1er du mois (mois suivants compris) et déjà enregistrés à l'instant du stock de fin. */
  mouvements: MouvementsAgreges;
  /** Création de l'article (instant) ; comparée au 1er du mois à 00 h de Kinshasa. */
  creeLe?: Date | null;
  debutMois: Date;
  /** Un mouvement daté d'avant le 1er existe : l'article existait (import d'historique), même créé tard. */
  mouvementAvantDebut?: boolean;
  /** Raison pour laquelle le stock a changé HORS mouvement depuis le 1er (inventaire importé…) ; null = rien. */
  stockModifieHorsMouvement?: string | null;
};

export function calculerStockInitial(e: EntreeCalcul): StockInitial {
  if (e.creeLe && e.creeLe.getTime() >= e.debutMois.getTime() && !e.mouvementAvantDebut) {
    return { etat: "absent", raison: "article créé après le 1er du mois : il n'existait pas encore" };
  }
  if (e.stockFin === null) return { etat: "inconnu", raison: "aucun stock enregistré pour cet article" };
  if (e.stockModifieHorsMouvement) return { etat: "inconnu", raison: e.stockModifieHorsMouvement };
  const aj = e.mouvements.ajustements;
  if (aj.nb > 0 && aj.net === null) {
    return { etat: "inconnu", raison: "ajustement de comptage dont le sens n'est pas établi (comptage retrouvé en désaccord avec les mouvements)" };
  }
  const initial = dec(e.stockFin).minus(dec(e.mouvements.entrees)).plus(dec(e.mouvements.sorties)).minus(dec(aj.net ?? 0));
  if (!initial.isFinite()) return { etat: "inconnu", raison: "quantité illisible" };
  if (initial.isNegative() && !initial.isZero()) {
    return { etat: "inconnu", raison: `le calcul donne un stock négatif (${arrondi(initial)}) : un changement de stock n'est pas enregistré comme mouvement` };
  }
  return { etat: "ok", quantite: arrondi(initial) };
}

/** Quantité à afficher/sommer : le nombre, ou null (« — ») quand l'article n'existait pas ou que le calcul est impossible. */
export const quantiteInitiale = (s: StockInitial): number | null => (s.etat === "ok" ? s.quantite : null);

// ── Contrôle avec la clôture du mois précédent ────────────────────────────────────

export type EcartCloture = { cloture: number; calcule: number; ecart: number };

/**
 * Compare le stock initial reconstitué au stock initial que la clôture du mois précédent donne pour le MÊME 1er
 * (instantané figé, ramené au 1er par les mouvements déjà enregistrés à la clôture). Les deux viennent des mêmes
 * règles : sans changement de stock hors mouvement depuis la clôture, ils sont égaux. Un écart signale un stock
 * touché sans mouvement (import, correction à la main) ou un mouvement supprimé depuis. Rien n'est corrigé.
 */
export function ecartAvecCloture(calcule: StockInitial, cloture: StockInitial | null | undefined): EcartCloture | null {
  if (!cloture || calcule.etat !== "ok" || cloture.etat !== "ok") return null;
  const ecart = dec(calcule.quantite).minus(dec(cloture.quantite));
  if (ecart.abs().lessThan(0.0005)) return null;
  return { cloture: cloture.quantite, calcule: calcule.quantite, ecart: arrondi(ecart) };
}

// ── Données agrégées d'un mois (remplies par le chargeur) et résultat par article ──────

export type DonneesStockInitial = {
  annee: number;
  mois: number;
  /** 1er du mois 00 h Kinshasa (instant). */
  debut: Date;
  /** Mois clôturé : instant de l'instantané ; absent = mois non clôturé (stock actuel). */
  figeLe?: Date;
  /** Mouvements datés DANS le mois. */
  dansMois: Map<string, MouvementsAgreges>;
  /** Mouvements datés APRÈS le mois (déjà enregistrés à l'instant du stock de fin). */
  apresMois: Map<string, MouvementsAgreges>;
  /** Articles créés à partir du 1er du mois (id → création). */
  crees: Map<string, Date>;
  /** Parmi eux, ceux qui ont un mouvement daté d'avant le 1er. */
  avecMouvementAvant: Set<string>;
  /** Articles dont le stock a été posé hors mouvement depuis le 1er (id → raison). */
  horsMouvement: Map<string, string>;
  /** Clôture du mois précédent exploitable : stock figé par article et mouvements (date ≥ 1er) déjà enregistrés à cet instant. */
  cloturePrecedente?: { annee: number; mois: number; figeLe: Date; stocks: Map<string, Quantite>; mouvements: Map<string, MouvementsAgreges> };
};

export type StockInitialArticle = {
  initial: StockInitial;
  /** Mouvements du mois (null = ajustements au sens inconnu), pour décomposer : début + entrées − sorties ± ajustements + après = fin. */
  entrees: number;
  sorties: number;
  ajustements: number | null;
  apres: number | null;
  /** Stock initial que la clôture du mois précédent donne pour le même 1er ; null = pas de comparaison possible (pas de clôture, article absent de l'instantané, calcul inconnu). */
  referenceCloture: number | null;
  /** Écart avec cette référence, s'il y en a un (absent = la clôture retombe juste, ou pas de comparaison). */
  ecartCloture?: EcartCloture;
};

const net = (m: MouvementsAgreges) => (m.ajustements.net === null ? null : arrondi(dec(m.ajustements.net)));

/** Stock initial d'UN article et décomposition de son mois, à partir des données agrégées. */
export function stockInitialArticle(d: DonneesStockInitial, articleId: string, stockFin: Quantite | null): StockInitialArticle {
  const mois = d.dansMois.get(articleId) ?? SANS_MOUVEMENT;
  const apres = d.apresMois.get(articleId) ?? SANS_MOUVEMENT;
  const creeLe = d.crees.get(articleId) ?? null;
  const commun = { creeLe, debutMois: d.debut, mouvementAvantDebut: d.avecMouvementAvant.has(articleId), stockModifieHorsMouvement: d.horsMouvement.get(articleId) ?? null };
  const initial = calculerStockInitial({ ...commun, stockFin, mouvements: additionner(mois, apres) });
  const clot = d.cloturePrecedente;
  const reference = clot
    ? calculerStockInitial({ ...commun, stockFin: clot.stocks.get(articleId) ?? null, mouvements: clot.mouvements.get(articleId) ?? SANS_MOUVEMENT })
    : null;
  const ecart = ecartAvecCloture(initial, reference);
  return {
    initial,
    referenceCloture: reference && initial.etat === "ok" ? quantiteInitiale(reference) : null,
    entrees: arrondi(dec(mois.entrees)),
    sorties: arrondi(dec(mois.sorties)),
    ajustements: net(mois),
    apres: apres.ajustements.net === null ? null : arrondi(dec(apres.entrees).minus(dec(apres.sorties)).plus(dec(apres.ajustements.net))),
    ...(ecart ? { ecartCloture: ecart } : {}),
  };
}

// ── Présentation (écran Inventaire) ────────────────────────────────────────────────────

export type StockDebutEcran = {
  /** null = « — » (inconnu, ou article inexistant au 1er). */
  stockDebutMois: number | null;
  /** Pourquoi « — » (infobulle). */
  stockDebutNote?: string;
  /** Écart avec la clôture du mois précédent (pastille « Écart clôture »). */
  ecartCloture?: { cloture: number; ecart: number; periode: string };
};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Ce que l'écran montre pour un article : la quantité, ou « — » avec sa raison, et la pastille d'écart s'il y en a un. */
export function pourEcran(r: StockInitialArticle, cloture?: { annee: number; mois: number } | null): StockDebutEcran {
  return {
    stockDebutMois: quantiteInitiale(r.initial),
    ...(r.initial.etat !== "ok" ? { stockDebutNote: r.initial.etat === "absent" ? `Absent au 1er : ${r.initial.raison}` : `Non calculable : ${r.initial.raison}` } : {}),
    ...(r.ecartCloture && cloture ? { ecartCloture: { cloture: r.ecartCloture.cloture, ecart: r.ecartCloture.ecart, periode: `${MOIS[cloture.mois - 1]} ${cloture.annee}` } } : {}),
  };
}
