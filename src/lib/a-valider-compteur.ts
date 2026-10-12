// LE COMPTEUR « À VALIDER » DE L'ESPACE RH — une seule définition, lue par le badge du menu
// (`(app)/layout.tsx`) ET par le compteur « En attente » de la page (`(app)/a-valider/page.tsx`).
// Avant (audit du 2026-10-12, D2) les deux comptaient autrement : le menu oubliait les attestations
// demandées, la page ajoutait les bulletins brouillons — la Direction voyait deux chiffres pour la
// même file. Module pur (ni base ni React).
//
// Ce qui compte : les demandes réelles (congés, modifications et créations de fiches, acomptes,
// attestations, échanges et changements de shift), les bulletins du mois À VALIDER (brouillons,
// hors calcul exclus) et les bulletins VALIDÉS restant à payer. Les brouillons ne comptaient pas
// depuis le 2026-07-22 ; la Direction les veut dans la pastille (décision du 2026-10-12).

export type ElementsAValider = {
  conges: number;
  fiches: number; // modifications de champs sensibles + créations de fiches
  acomptes: number;
  attestations: number;
  echanges: number;
  changements: number;
  bulletinsAValider: number; // brouillons du mois, hors calcul exclus
  bulletinsAPayer: number;
};

export function totalAValiderRH(e: ElementsAValider): number {
  return e.conges + e.fiches + e.acomptes + e.attestations + e.echanges + e.changements + e.bulletinsAValider + e.bulletinsAPayer;
}

/**
 * Même chose côté STOCK : les bons de commande en brouillon (visibles de tous les comptes Stock) et
 * les demandes de validation en attente (toutes pour la Direction, les siennes pour un autre compte —
 * c'est ce que la page montre). Badge du menu et compteur de la page lisent cette fonction.
 */
export function totalAValiderStock(e: { bonsEnBrouillon: number; demandes: number }): number {
  return e.bonsEnBrouillon + e.demandes;
}
