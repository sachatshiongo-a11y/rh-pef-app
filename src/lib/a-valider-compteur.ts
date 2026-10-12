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

// ── Par rôle (plan d'ergonomie, V1) ───────────────────────────────────────────────────────────
// La boîte « À valider » est visible par TOUS les rôles de l'espace. Le badge du menu et le compteur
// de la page doivent donc compter ce que CE rôle voit — jamais les demandes des autres (annexe D).

/** Les demandes de fiche (modifications + créations) en attente dont `auteurId` est l'auteur. */
export type MesDemandesFiche = number;

/**
 * Ce que le rôle voit dans l'espace RH, à partir des chiffres de TOUTE la file.
 *  - Direction (ADMIN) : toute la file ;
 *  - Responsable RH (MANAGER) : ses propres demandes de fiche + les bulletins validés qu'il PAIE ;
 *  - tout autre rôle (consultation) : ses propres demandes de fiche (en pratique aucune).
 * Ni congés, ni acomptes, ni attestations, ni shifts : ce sont les demandes des salariés, à la Direction.
 */
export function elementsAValiderPour(role: string, toute: ElementsAValider, mesDemandesFiche: MesDemandesFiche): ElementsAValider {
  if (role === "ADMIN") return toute;
  return {
    conges: 0, fiches: mesDemandesFiche, acomptes: 0, attestations: 0, echanges: 0, changements: 0, bulletinsAValider: 0,
    bulletinsAPayer: role === "MANAGER" ? toute.bulletinsAPayer : 0,
  };
}

/** Le chiffre du badge « À valider » RH et du compteur de la page, pour ce rôle. */
export function totalAValiderRHPour(role: string, toute: ElementsAValider, mesDemandesFiche: MesDemandesFiche): number {
  return totalAValiderRH(elementsAValiderPour(role, toute, mesDemandesFiche));
}

/** Exploitation : les demandes de ratios en attente (toutes pour la Direction, les siennes pour la Compta). */
export function totalAValiderExploitation(e: { demandesRatios: number }): number {
  return e.demandesRatios;
}

// ── Entre espaces (V11) ───────────────────────────────────────────────────────────────────────
export type EspaceAValider = "rh" | "stock" | "exploitation";
export type AttenteParEspace = Record<EspaceAValider, number>;

/** Les trois boîtes « À valider », dans l'ordre où le sélecteur et le rappel croisé les présentent. */
export const BOITES_A_VALIDER: { espace: EspaceAValider; nom: string; href: string }[] = [
  { espace: "rh", nom: "RH", href: "/a-valider" },
  { espace: "stock", nom: "Stock", href: "/stock/a-valider" },
  { espace: "exploitation", nom: "Exploitation", href: "/exploitation/a-valider" },
];

/** « Aussi en attente » : les AUTRES espaces dont la boîte n'est pas vide (jamais celui qu'on regarde, jamais un zéro). */
export function autresEnAttente(courant: EspaceAValider, attente: AttenteParEspace): { espace: EspaceAValider; nom: string; href: string; nombre: number }[] {
  return BOITES_A_VALIDER
    .filter((b) => b.espace !== courant && attente[b.espace] > 0)
    .map((b) => ({ ...b, nombre: attente[b.espace] }));
}

/** Mention d'une carte du sélecteur : « 4 à valider » ou « Rien à valider ». */
export function libelleAValider(n: number): string {
  return n > 0 ? `${n} à valider` : "Rien à valider";
}
