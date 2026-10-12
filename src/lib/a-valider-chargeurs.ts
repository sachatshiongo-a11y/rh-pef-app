import "server-only";

import { prisma } from "@/lib/prisma";
import { compterPasValideComptees } from "@/lib/paie-hors-calcul";
import { compterDemandesRatiosEnAttente } from "@/lib/exploitation/demandes-ratios";
import {
  elementsAValiderPour, totalAValiderExploitation, totalAValiderRH, totalAValiderRHPour, totalAValiderStock,
  type AttenteParEspace, type ElementsAValider, type EspaceAValider,
} from "@/lib/a-valider-compteur";

// CHARGEURS DES COMPTEURS « À VALIDER » — la lecture en base des définitions pures de
// `a-valider-compteur.ts`. Une seule source pour trois lecteurs : le badge du menu de chaque espace
// (layouts), le compteur « En attente » de chaque page, et — pour la Direction — les compteurs du
// sélecteur d'espace et la ligne « Aussi en attente » (plan d'ergonomie, V1 et V11).
//
// Règle de portée (annexe D du plan) : un rôle compte CE QU'IL VOIT. La Direction compte toute la file ;
// les autres, leurs propres demandes (et, côté RH, les bulletins validés que le Responsable RH paie).

type Compte = { id: string; role: string };

// Cache mémoire court des chiffres de TOUTE la file RH : évite de refaire ces requêtes à CHAQUE
// navigation (coûteux sur lien lent). 20 s de fraîcheur suffisent pour des badges d'attente.
let cacheRH: { at: number; elements: ElementsAValider } | null = null;
const TTL = 20_000;

/** Vide le cache (tests). */
export function reinitialiserCacheAValider() { cacheRH = null; }

/** Les chiffres de TOUTE la file RH, rubrique par rubrique (la portée d'un rôle se règle ensuite, en pur). */
export async function chargerElementsAValiderRH(): Promise<ElementsAValider> {
  if (cacheRH && Date.now() - cacheRH.at < TTL) return cacheRH.elements;

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const filtreRun = config ? { payrollRun: { mois: config.moisCourant, annee: config.anneeCourante } } : {};
  const [conges, bulletinsAValider, bulletinsAPayer, acomptes, changements, echanges, modifs, creations, attestations] = await Promise.all([
    prisma.leaveRequest.count({ where: { statut: "EN_ATTENTE" } }),
    compterPasValideComptees(prisma, filtreRun), // hors calcul exclues (paie-hors-calcul.ts)
    // À payer : tous mois confondus — la clôture fait passer l'espace RH au mois suivant, les bulletins
    // validés du mois clôturé restent dus (« À valider » les liste).
    prisma.payrollLine.count({ where: { statutPaiement: "VALIDE" } }),
    prisma.acompteSalaire.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.demandeChangementShift.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.echangeCreneau.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.demandeModifFiche.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.demandeCreationFiche.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.attestation.count({ where: { statut: "DEMANDEE" } }),
  ]);
  const elements: ElementsAValider = { conges, fiches: modifs + creations, acomptes, attestations, echanges, changements, bulletinsAValider, bulletinsAPayer };
  cacheRH = { at: Date.now(), elements };
  return elements;
}

/** Les demandes de fiche (modifications + créations) de CE compte, encore en attente. */
export async function compterMesDemandesFiche(auteurId: string): Promise<number> {
  const [modifs, creations] = await Promise.all([
    prisma.demandeModifFiche.count({ where: { statut: "EN_ATTENTE", auteurId } }),
    prisma.demandeCreationFiche.count({ where: { statut: "EN_ATTENTE", auteurId } }),
  ]);
  return modifs + creations;
}

/** RH : les chiffres que CE compte voit (rubrique par rubrique), et leur total — badge du menu et compteur de la page. */
export async function chargerAValiderRH(user: Compte): Promise<{ elements: ElementsAValider; total: number }> {
  const [toute, mes] = await Promise.all([
    chargerElementsAValiderRH(),
    user.role === "ADMIN" ? Promise.resolve(0) : compterMesDemandesFiche(user.id),
  ]);
  const elements = elementsAValiderPour(user.role, toute, mes);
  return { elements, total: totalAValiderRH(elements) };
}

/** Badge « À valider » RH + badges « Congés » et « Paie » du menu, pour ce compte. */
export async function chargerBadgesRH(user: Compte): Promise<Record<string, number>> {
  const [toute, mes] = await Promise.all([
    chargerElementsAValiderRH(),
    user.role === "ADMIN" ? Promise.resolve(0) : compterMesDemandesFiche(user.id),
  ]);
  // Paie : les bulletins que CE compte peut décider (Direction : à valider + à payer ; RH : à payer),
  // les mêmes chiffres que les liens « N à valider / N à payer » affichés en haut de Paie.
  const pourMoi = elementsAValiderPour(user.role, toute, mes);
  return {
    "/a-valider": totalAValiderRHPour(user.role, toute, mes),
    // Congés : badge d'écran de travail, pas de la boîte « À valider » (inchangé).
    "/conges": toute.conges,
    "/paie": pourMoi.bulletinsAValider + pourMoi.bulletinsAPayer,
  };
}

/** Stock : bons de commande en brouillon (visibles de tous les comptes Stock) + demandes de validation (toutes pour la Direction, les siennes sinon). */
export async function chargerAValiderStock(user: Compte): Promise<{ bonsEnBrouillon: number; demandes: number; total: number }> {
  const [bonsEnBrouillon, demandes] = await Promise.all([
    prisma.bonDeCommande.count({ where: { statut: "BROUILLON" } }),
    prisma.demandeValidationStock.count({ where: { statut: "EN_ATTENTE", ...(user.role === "ADMIN" ? {} : { auteurId: user.id }) } }),
  ]);
  return { bonsEnBrouillon, demandes, total: totalAValiderStock({ bonsEnBrouillon, demandes }) };
}

/** Exploitation : demandes de ratios en attente (toutes pour la Direction, les siennes pour la Compta). */
export async function chargerAValiderExploitation(user: Compte): Promise<number> {
  const demandesRatios = await compterDemandesRatiosEnAttente(user.role === "ADMIN" ? undefined : user.id);
  return totalAValiderExploitation({ demandesRatios });
}

/**
 * DIRECTION : ce qui attend dans chaque espace (sélecteur d'espace, ligne « Aussi en attente »). Les
 * mêmes fonctions que les badges des menus. `sauf` : un espace qu'on n'a pas besoin de compter (celui
 * qu'on regarde déjà) — il vaut alors 0.
 */
export async function chargerAttenteDirection(direction: Compte, sauf?: EspaceAValider): Promise<AttenteParEspace> {
  const [rh, stock, exploitation] = await Promise.all([
    sauf === "rh" ? 0 : chargerAValiderRH(direction).then((r) => r.total),
    sauf === "stock" ? 0 : chargerAValiderStock(direction).then((r) => r.total),
    sauf === "exploitation" ? 0 : chargerAValiderExploitation(direction),
  ]);
  return { rh, stock, exploitation };
}
