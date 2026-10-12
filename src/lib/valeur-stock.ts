// VALEURS DE STOCK INCOMPLÈTES — module PUR (écrans, exports, indicateurs).
//
// Règle maison : un montant incomplet est annoncé, jamais complété par un zéro. Un article (ou une
// sortie) sans prix n'a pas une valeur de 0 : il n'a pas de valeur. Les totaux le disent
// (« partiel : N sans prix »), comme les cartes « Entrées de stock » (audit du 10/10/2026, stock 10).

/** Mention d'un total partiel, ou "" quand rien ne manque : « partiel : 3 sans prix ». */
export const mentionSansPrix = (n: number): string => (n > 0 ? `partiel : ${n} sans prix` : "");

/** Somme des valeurs CONNUES (`null` = sans prix) et nombre de valeurs manquantes. */
export function sommeValeurs(valeurs: (number | null | undefined)[]): { montant: number; nbValorises: number; nbSansPrix: number } {
  let montant = 0, nbValorises = 0, nbSansPrix = 0;
  for (const v of valeurs) {
    if (v === null || v === undefined || !Number.isFinite(v)) nbSansPrix++;
    else { montant += v; nbValorises++; }
  }
  return { montant, nbValorises, nbSansPrix };
}

type PartConso = { montant: number; nb: number; nbSansPrix: number };
type ConsoMois = { nb: number; nbSansPrix: number; livraisons: PartConso; pertes: PartConso; sansMotif: PartConso };

/**
 * Sous-texte de la carte « Consommation du mois » : le nombre de sorties VALORISÉES (les seules qui
 * pèsent dans le montant), la mention « partiel : N sans prix » s'il en manque, puis le détail par
 * motif — livraisons au restaurant et pertes ne se confondent pas. `fmt` met un montant en dollars.
 */
export function detailConso(c: ConsoMois, fmt: (n: number) => string, francsSansTaux = 0): string {
  const parts = [`${c.nb} sortie(s) valorisée(s)`];
  if (c.nbSansPrix > 0) parts.push(mentionSansPrix(c.nbSansPrix));
  parts.push(`livraisons restaurant ${fmt(c.livraisons.montant)}`, `pertes ${fmt(c.pertes.montant)}`);
  if (c.sansMotif.nb + c.sansMotif.nbSansPrix > 0) parts.push(`sans motif ${fmt(c.sansMotif.montant)}`);
  if (francsSansTaux > 0) parts.push(`dont ${francsSansTaux} en FC non valorisée(s) : taux non défini`);
  return parts.join(" · ");
}
