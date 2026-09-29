// LA NAVIGATION DE L'ESPACE STOCK — une seule liste, lue par le menu (tiroir sur téléphone, barre
// latérale sur ordinateur) et par la barre du bas.
import type { CandidatBarre, GroupeMenu } from "@/lib/navigation-espaces";
import { ENTREE_MENU_ACHATS, sousOngletActif } from "@/lib/achats-liste";

export const NAV_GROUPS: GroupeMenu[] = [
  {
    titre: "Pilotage",
    items: [
      { href: "/stock", label: "Tableau de bord", icone: "accueil" },
      { href: "/stock/a-valider", label: "Demandes à valider", icone: "valider", adminOnly: true },
      { href: "/stock/archives", label: "Archives", icone: "archives" },
    ],
  },
  {
    titre: "Dépôt",
    items: [
      { href: "/stock/catalogue", label: "Inventaire", icone: "marmite" },
      ENTREE_MENU_ACHATS, // Mouvements · Liste d'achat · Légumes frais (sous-onglets)
      { href: "/stock/reconciliation", label: "Réconciliation", icone: "balance" },
    ],
  },
  {
    titre: "Restaurant",
    items: [
      { href: "/stock/restaurant", label: "Stock restaurant", icone: "couverts" },
      { href: "/stock/fiches", label: "Fiches techniques", icone: "document" },
      { href: "/stock/journalier", label: "Conso. journalière", icone: "calendrierJours" },
    ],
  },
  {
    titre: "Achats",
    items: [
      { href: "/stock/commandes", label: "Bons de commande", icone: "presence" },
      { href: "/stock/fournisseurs", label: "Fournisseurs", icone: "camion" },
      { href: "/stock/factures", label: "Factures", icone: "recu" },
    ],
  },
  {
    titre: "Configuration",
    items: [
      { href: "/stock/imports", label: "Imports", icone: "importer", adminOnly: true },
      { href: "/parametres", label: "Paramètres", icone: "parametres", adminOnly: true },
      { href: "/stock/utilisateurs", label: "Utilisateurs", icone: "employes", adminOnly: true },
    ],
  },
];

/**
 * Barre du bas (téléphone) — la journée du magasinier : le tableau de bord, l'Inventaire (les
 * quantités du dépôt, badge rouge des ruptures), « Achats & mouvements » où l'on enregistre ce qui
 * entre et sort (liste d'achat, légumes du marché) et la Conso. journalière du restaurant, saisie
 * chaque jour. Bons de commande, factures et fournisseurs suivent le rythme des livraisons : menu.
 */
export const BARRE_DU_BAS: CandidatBarre[] = [
  { href: "/stock", court: "Accueil" },
  { href: "/stock/catalogue", court: "Inventaire" },
  { href: ENTREE_MENU_ACHATS.href, court: "Achats" },
  { href: "/stock/journalier", court: "Conso." },
];

/** État actif (menu et barre) : le tableau de bord sur son adresse exacte, « Achats & mouvements »
 *  sur ses trois sous-onglets, le reste sur le préfixe. */
export function lienActif(href: string, pathname: string): boolean {
  return href === ENTREE_MENU_ACHATS.href ? sousOngletActif(pathname) !== null // active sur ses trois sous-onglets
    : href === "/stock" ? pathname === href : pathname.startsWith(href);
}
