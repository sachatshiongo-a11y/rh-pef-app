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

import type { Role } from "@prisma/client";
import { estExploitation, estRH, estStock } from "@/lib/espaces";

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
 *  - Responsable RH (MANAGER) : ses propres demandes de fiche + les deux gestes qu'il avait déjà —
 *    payer les bulletins validés et acter les échanges / changements de shift (c'est lui qui tient le planning) ;
 *  - tout autre rôle (consultation) : ses propres demandes de fiche (en pratique aucune).
 * Ni congés, ni acomptes, ni attestations, ni bulletins à valider : ce sont les demandes des salariés, à la Direction.
 */
export function elementsAValiderPour(role: string, toute: ElementsAValider, mesDemandesFiche: MesDemandesFiche): ElementsAValider {
  if (role === "ADMIN") return toute;
  return {
    conges: 0, fiches: mesDemandesFiche, acomptes: 0, attestations: 0, bulletinsAValider: 0,
    echanges: role === "MANAGER" ? toute.echanges : 0,
    changements: role === "MANAGER" ? toute.changements : 0,
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

// ── Une seule boîte « À valider », tous espaces confondus (2026-10-12) ────────────────────────
// La Direction a demandé UNE page « À valider » et UNE pastille, les mêmes quel que soit l'espace d'où on
// les ouvre. Trois rubriques d'espace (RH, Stock, Exploitation) ; chaque compte ne reçoit que celles de ses
// espaces. Les fonctions ci-dessous sont PURES (ni base ni session) : la matrice des rôles se teste telle quelle.
export type EspaceAValider = "rh" | "stock" | "exploitation";
export type AttenteParEspace = Record<EspaceAValider, number>;

/** Les trois boîtes, dans l'ordre d'affichage de la page, du sélecteur d'espace et des tests. L'adresse est le point
 *  d'ouverture de la page dans la coquille de chaque espace (menus, flèche de retour) : c'est la MÊME page. */
export const BOITES_A_VALIDER: { espace: EspaceAValider; nom: string; href: string }[] = [
  { espace: "rh", nom: "RH", href: "/a-valider" },
  { espace: "stock", nom: "Stock", href: "/stock/a-valider" },
  { espace: "exploitation", nom: "Exploitation", href: "/exploitation/a-valider" },
];

/** Le compte, tel que les chargeurs et la page le connaissent. `accesStock` : le salarié à qui l'accès Stock a été accordé. */
export type CompteAValider = { id: string; role: string; accesStock?: boolean };

/**
 * Les espaces dont ce compte lit la boîte — les MÊMES prédicats que les layouts, `requireModule` et les gardes
 * de pages (`lib/espaces.ts`). Un espace qui n'est pas ici n'est ni chargé, ni compté, ni nommé : pas de
 * requête inutile, pas de fuite.
 */
export function espacesAValider(user: { role: string; accesStock?: boolean }): Record<EspaceAValider, boolean> {
  const compte = { role: user.role as Role, accesStock: user.accesStock };
  return { rh: estRH(compte.role), stock: estStock(compte), exploitation: estExploitation(compte) };
}

export type RubriqueRH = "conges" | "modifications-fiches" | "acomptes" | "attestations" | "echanges" | "changements" | "bulletins-a-valider" | "bulletins-a-payer";
export type RubriqueStock = "bons-de-commande" | "demandes";
export type RubriqueExploitation = "demandes-ratios";

const TOUTES_RUBRIQUES_RH: RubriqueRH[] = ["conges", "modifications-fiches", "acomptes", "attestations", "echanges", "changements", "bulletins-a-valider", "bulletins-a-payer"];

/**
 * Les rubriques RH que ce rôle voit (anciennement deux ensembles dans la page) :
 *  - Direction : toute la file ;
 *  - Responsable RH : SES demandes de fiche + payer les bulletins validés + acter échanges et changements de shift ;
 *  - consultation : ses demandes de fiche (en pratique aucune) ;
 *  - tout autre rôle (Stock, Compta, salarié) : aucune — la RH n'est pas son espace.
 */
export function rubriquesRH(role: string): RubriqueRH[] {
  if (!estRH(role as Role)) return [];
  if (role === "ADMIN") return [...TOUTES_RUBRIQUES_RH];
  const siens: RubriqueRH[] = ["modifications-fiches"];
  return role === "MANAGER" ? [...siens, "echanges", "changements", "bulletins-a-payer"] : siens;
}

/** Les rubriques de la page « À valider » de ce compte, par espace (vide = l'espace n'est pas à lui). */
export function rubriquesVisibles(user: { role: string; accesStock?: boolean }): { rh: RubriqueRH[]; stock: RubriqueStock[]; exploitation: RubriqueExploitation[] } {
  const e = espacesAValider(user);
  return {
    rh: e.rh ? rubriquesRH(user.role) : [],
    stock: e.stock ? ["bons-de-commande", "demandes"] : [],
    exploitation: e.exploitation ? ["demandes-ratios"] : [],
  };
}

/**
 * LE TOTAL « À valider » D'UN COMPTE, tous espaces confondus : la pastille du menu des trois espaces ET le
 * compteur « En attente » de la page. Chaque espace est compté comme avant (`totalAValiderRHPour`,
 * `totalAValiderStock`, `totalAValiderExploitation`) ; un espace qui n'est pas au compte vaut 0.
 */
export function totalAValiderCompte(parEspace: AttenteParEspace): number {
  return parEspace.rh + parEspace.stock + parEspace.exploitation;
}

/** Mention d'une carte du sélecteur : « 4 à valider » ou « Rien à valider ». */
export function libelleAValider(n: number): string {
  return n > 0 ? `${n} à valider` : "Rien à valider";
}
