import "server-only";

import { prisma } from "@/lib/prisma";
import { lireConfigDuRendu } from "@/lib/config-rendu";
import { compterPasValideComptees } from "@/lib/paie-hors-calcul";
import { compterDemandesRatiosEnAttente } from "@/lib/exploitation/demandes-ratios";
import {
  elementsAValiderPour, espacesAValider, totalAValiderCompte, totalAValiderExploitation, totalAValiderRH, totalAValiderStock,
  type AttenteParEspace, type CompteAValider, type ElementsAValider, type EspaceAValider,
} from "@/lib/a-valider-compteur";

// CHARGEURS DES COMPTEURS « À VALIDER » — la lecture en base des définitions pures de
// `a-valider-compteur.ts`. Une seule source pour trois lecteurs : le badge du menu de chaque espace
// (layouts), le compteur « En attente » de chaque page, et — pour la Direction — les compteurs du
// sélecteur d'espace (plan d'ergonomie, V1 et V11).
//
// Règle de portée (annexe D du plan) : un rôle compte CE QU'IL VOIT. La Direction compte toute la file ;
// les autres, leurs propres demandes (et, côté RH, les bulletins validés que le Responsable RH paie).
//
// UNE SEULE PASTILLE (2026-10-12) : `chargerAValiderDuCompte` / `chargerTotalAValider` donnent le total d'un
// compte TOUS ESPACES CONFONDUS — la pastille « À valider » des menus RH, Stock et Exploitation, comme le
// compteur de la page unique. Seuls les espaces du compte sont lus (`espacesAValider`) ; chaque espace
// garde son chargeur d'avant (`chargerAValiderRH`, `chargerAValiderStock`, `chargerAValiderExploitation`).

type Compte = CompteAValider;

// Cache mémoire court des chiffres de TOUTE la file RH : évite de refaire ces requêtes à CHAQUE
// navigation (coûteux sur lien lent). 20 s de fraîcheur suffisent pour des badges d'attente.
//
// MAIS une décision doit se voir TOUT DE SUITE (Direction, 13/10/2026) : chaque action serveur qui crée, approuve,
// refuse, annule ou supprime un élément compté ici appelle `reinitialiserCacheAValider()` APRÈS son écriture réussie
// (garde-fou : `a-valider-cache.garde-fou.test.ts`). Le Stock et l'Exploitation ne sont PAS dans ce cache : leurs
// compteurs (`chargerAValiderStock`, `chargerAValiderExploitation`) se lisent en direct à chaque appel.
//
// L'état vit sur `globalThis` : si le bundle des actions serveur et celui des pages embarquaient chacun leur copie
// de ce module, une copie viderait un cache que l'autre ne lirait pas. `generation` empêche une lecture partie AVANT
// une écriture de remettre en cache, en finissant APRÈS, un chiffre déjà périmé.
const TTL = 20_000;
type EtatCache = { cache: { at: number; elements: ElementsAValider } | null; generation: number };
const globale = globalThis as typeof globalThis & { __aValiderCacheRH?: EtatCache };
const etat: EtatCache = (globale.__aValiderCacheRH ??= { cache: null, generation: 0 });

/** Vide le cache : à appeler après toute écriture d'un élément compté dans « À valider » (et dans les tests). */
export function reinitialiserCacheAValider() { etat.cache = null; etat.generation++; }

/** Les chiffres de TOUTE la file RH, rubrique par rubrique (la portée d'un rôle se règle ensuite, en pur). */
export async function chargerElementsAValiderRH(): Promise<ElementsAValider> {
  if (etat.cache && Date.now() - etat.cache.at < TTL) return etat.cache.elements;
  const generation = etat.generation;

  const config = await lireConfigDuRendu();
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
  if (generation === etat.generation) etat.cache = { at: Date.now(), elements }; // une écriture est passée pendant la lecture : on ne garde pas ce chiffre
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

/** RH : les chiffres de TOUTE la file, puis ceux que CE compte voit (rubrique par rubrique) et leur total. */
async function lireRH(user: Compte): Promise<{ toute: ElementsAValider; elements: ElementsAValider; total: number }> {
  const [toute, mes] = await Promise.all([
    chargerElementsAValiderRH(),
    user.role === "ADMIN" ? Promise.resolve(0) : compterMesDemandesFiche(user.id),
  ]);
  const elements = elementsAValiderPour(user.role, toute, mes);
  return { toute, elements, total: totalAValiderRH(elements) };
}

/** RH : les chiffres que CE compte voit (rubrique par rubrique), et leur total — badge « Paie » et rubriques de la page. */
export async function chargerAValiderRH(user: Compte): Promise<{ elements: ElementsAValider; total: number }> {
  const { elements, total } = await lireRH(user);
  return { elements, total };
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

export type AValiderDuCompte = {
  /** Les espaces dont ce compte lit la boîte. */
  espaces: Record<EspaceAValider, boolean>;
  /** Le détail de chaque espace du compte, `null` pour un espace qui n'est pas à lui (rien n'y a été lu). */
  rh: { elements: ElementsAValider; toute: ElementsAValider; total: number } | null;
  stock: { bonsEnBrouillon: number; demandes: number; total: number } | null;
  exploitation: number | null;
  /** Le total de chaque espace (0 pour un espace qui n'est pas au compte). */
  parEspace: AttenteParEspace;
  /** LA pastille : tous les espaces du compte confondus. */
  total: number;
};

/**
 * Ce qui attend CE compte, espace par espace, et le total. Les trois lectures partent en parallèle ; un espace
 * qui n'est pas au compte n'est PAS interrogé (une requête de moins, et aucune fuite d'un compteur qu'il ne doit pas voir).
 */
export async function chargerAValiderDuCompte(user: Compte): Promise<AValiderDuCompte> {
  const espaces = espacesAValider(user);
  const [rh, stock, exploitation] = await Promise.all([
    espaces.rh ? lireRH(user) : Promise.resolve(null),
    espaces.stock ? chargerAValiderStock(user) : Promise.resolve(null),
    espaces.exploitation ? chargerAValiderExploitation(user) : Promise.resolve(null),
  ]);
  const parEspace: AttenteParEspace = { rh: rh?.total ?? 0, stock: stock?.total ?? 0, exploitation: exploitation ?? 0 };
  return { espaces, rh, stock, exploitation, parEspace, total: totalAValiderCompte(parEspace) };
}

/** La pastille « À valider » d'un compte (menus des trois espaces) : le total, tous espaces confondus. */
export async function chargerTotalAValider(user: Compte): Promise<number> {
  return (await chargerAValiderDuCompte(user)).total;
}

/**
 * Badges du menu RH : « À valider » (le total de tous les espaces du compte), « Congés » et « Paie » (inchangés,
 * propres à la RH : les bulletins que CE compte peut décider — Direction : à valider + à payer ; RH : à payer —,
 * les mêmes chiffres que les liens « N à valider / N à payer » de Paie).
 */
export async function chargerBadgesRH(user: Compte): Promise<Record<string, number>> {
  const { rh, total } = await chargerAValiderDuCompte(user);
  return {
    "/a-valider": total,
    // Congés : badge d'écran de travail, pas de la boîte « À valider » (inchangé).
    "/conges": rh?.toute.conges ?? 0,
    "/paie": rh ? rh.elements.bulletinsAValider + rh.elements.bulletinsAPayer : 0,
  };
}

/**
 * DIRECTION : ce qui attend dans chaque espace (cartes du sélecteur d'espace). Les mêmes fonctions que
 * la pastille unique, espace par espace. `sauf` : un espace qu'on n'a pas besoin de compter — il vaut alors 0.
 */
export async function chargerAttenteDirection(direction: Compte, sauf?: EspaceAValider): Promise<AttenteParEspace> {
  const [rh, stock, exploitation] = await Promise.all([
    sauf === "rh" ? 0 : chargerAValiderRH(direction).then((r) => r.total),
    sauf === "stock" ? 0 : chargerAValiderStock(direction).then((r) => r.total),
    sauf === "exploitation" ? 0 : chargerAValiderExploitation(direction),
  ]);
  return { rh, stock, exploitation };
}
