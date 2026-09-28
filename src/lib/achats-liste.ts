import type { Prisma } from "@prisma/client";
import { jourKinshasaISO } from "@/lib/date-paiement";

// ACHATS & MOUVEMENTS — règles partagées de la Liste d'achat (décisions Direction 2026-09-28).
//
// Module pur (ni base, ni `server-only`) : importé par les actions serveur, les pages ET le menu
// (composant client). Les requêtes qui interrogent la base vivent dans `achats-liste-serveur.ts`.

/** Origine posée par défaut sur une ligne de la Liste d'achat. */
export const ORIGINE_LISTE_ACHAT = "Liste d'achat";

/**
 * Les autres chemins qui créent une ENTRÉE sans facture posent une origine FIXE : on les écarte
 * de l'historique de la Liste d'achat par elle. (Une entrée manuelle dont on a tapé le motif, ou
 * un import dont on a choisi le libellé, reste indiscernable : aucun champ ne la distingue.)
 */
export const ORIGINES_HORS_LISTE = ["Entrée manuelle"] as const;
export const PREFIXES_HORS_LISTE = ["Correction stock négatif"] as const;

/**
 * L'historique de la Liste d'achat : les ACHATS saisis par son formulaire, et eux seuls.
 * - `factureId: null` : une entrée par facture vit dans Factures (et dans Mouvements) ;
 * - `receptionId: null` : une entrée de réception de bon de commande non plus — sinon le même
 *   achat s'affichait deux fois (piège de la double saisie) ;
 * - origine : ni entrée manuelle, ni correction de stock négatif. `origine` NULL reste inclus :
 *   un `NOT IN` seul l'exclurait (sémantique SQL des NULL).
 */
export const WHERE_ACHATS_LISTE: Prisma.MouvementStockWhereInput = {
  type: "ENTREE",
  factureId: null,
  receptionId: null,
  OR: [
    { origine: null },
    {
      origine: { notIn: [...ORIGINES_HORS_LISTE] },
      NOT: PREFIXES_HORS_LISTE.map((p) => ({ origine: { startsWith: p } })),
    },
  ],
};

/**
 * Lit et valide la date d'un achat saisie (`AAAA-MM-JJ`) :
 * - absente → aujourd'hui À KINSHASA (le serveur tourne en UTC : entre 0 h et 1 h, son « jour »
 *   est encore la veille) ;
 * - illisible ou hors calendrier → refus ;
 * - dans le futur → refus.
 * La période de stock clôturée est contrôlée à part (`exigerPeriodeOuverte`, en base).
 */
export function lireDateAchat(saisie: string | null | undefined, maintenant: Date = new Date()): string {
  const aujourdHui = jourKinshasaISO(maintenant);
  const s = (saisie ?? "").trim();
  if (!s) return aujourdHui;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Date de l'achat invalide.");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error("Date de l'achat invalide.");
  if (s > aujourdHui) throw new Error("La date de l'achat ne peut pas être dans le futur.");
  return s;
}

/** `AAAA-MM-JJ` → `JJ/MM/AAAA` (dates PURES, sans fuseau). */
export function jjmmaaaa(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
}

type MvtFournisseur = {
  facture: { fournisseurId: string | null; fournisseurNom: string | null } | null;
  reception: { bonDeCommande: { fournisseurId: string | null; fournisseur: { nom: string } | null } | null } | null;
  fournisseur: { id: string; nom: string } | null;
};

/**
 * Le fournisseur d'une entrée, pour un LIEN vers sa fiche : celui de la facture, sinon celui du
 * bon de commande réceptionné, sinon celui saisi sur la ligne de la Liste d'achat. Sans fiche
 * fournisseur (id inconnu), rien : jamais un lien vers une fiche qui n'existe pas.
 */
export function fournisseurDuMouvement(m: MvtFournisseur): { id: string; nom: string } | null {
  if (m.facture?.fournisseurId) return { id: m.facture.fournisseurId, nom: m.facture.fournisseurNom ?? "Fournisseur" };
  const bc = m.reception?.bonDeCommande;
  if (bc?.fournisseurId) return { id: bc.fournisseurId, nom: bc.fournisseur?.nom ?? "Fournisseur" };
  if (m.fournisseur) return { id: m.fournisseur.id, nom: m.fournisseur.nom };
  return null;
}

/** Les trois sous-onglets de l'entrée de menu « Achats & mouvements » (routes inchangées). */
export const SOUS_ONGLETS_ACHATS = [
  { href: "/stock/mouvements", label: "Mouvements", aide: "toutes les entrées et sorties du dépôt" },
  { href: "/stock/entree", label: "Liste d'achat", aide: "achats sans facture, qui entrent en stock" },
  { href: "/stock/legumes", label: "Légumes frais", aide: "achats du marché, hors stock" },
] as const;

/** Le sous-onglet de la page courante (la page elle-même ou l'un de ses sous-chemins), sinon null. */
export function sousOngletActif(pathname: string): string | null {
  const o = SOUS_ONGLETS_ACHATS.find((x) => pathname === x.href || pathname.startsWith(`${x.href}/`));
  return o ? o.href : null;
}

/** L'entrée du menu Stock qui mène aux trois sous-onglets (elle s'ouvre sur Mouvements). */
export const ENTREE_MENU_ACHATS = { href: SOUS_ONGLETS_ACHATS[0].href, label: "Achats & mouvements", icone: "panier" };
