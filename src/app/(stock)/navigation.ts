// LA NAVIGATION DE L'ESPACE STOCK — une seule liste, lue par le menu (tiroir sur téléphone, barre
// latérale sur ordinateur) et par la barre du bas.
import type { CandidatBarre, GroupeMenu } from "@/lib/navigation-espaces";
import { ENTREE_MENU_ACHATS, sousOngletActif } from "@/lib/achats-liste";

export const NAV_GROUPS: GroupeMenu[] = [
  {
    titre: "Pilotage",
    items: [
      { href: "/stock", label: "Accueil", icone: "accueil" },
      // Visible par tous les rôles du Stock : la Direction décide, les autres suivent leurs demandes (V1).
      { href: "/stock/a-valider", label: "À valider", icone: "valider" },
    ],
  },
  {
    titre: "Dépôt",
    items: [
      { href: "/stock/catalogue", label: "Inventaire", icone: "marmite" },
      ENTREE_MENU_ACHATS, // Mouvements · Liste d'achat · Légumes frais (sous-onglets)
      { href: "/stock/reconciliation", label: "Réconciliation", icone: "balance" }, // + onglet « Comptages passés »
      // La clôture du mois se fait ici, comme la paie dans Paie et l'exploitation dans Exploitation (V8).
      // Direction seule : la page refuse les autres comptes et les actions revérifient ADMIN.
      { href: "/stock/cloture", label: "Clôture du mois", icone: "calendrier", adminOnly: true },
    ],
  },
  {
    titre: "Restaurant",
    items: [
      { href: "/stock/journalier", label: "Conso. journalière", icone: "calendrierJours" },
      { href: "/stock/restaurant", label: "Stock restaurant", icone: "couverts" },
      { href: "/stock/fiches", label: "Fiches techniques", icone: "document" },
    ],
  },
  {
    titre: "Fournisseurs & factures",
    items: [
      { href: "/stock/commandes", label: "Bons de commande", icone: "presence" }, // + filtre d'état « Validés »
      { href: "/stock/factures", label: "Factures", icone: "recu" },
      { href: "/stock/fournisseurs", label: "Fournisseurs", icone: "camion" },
    ],
  },
  {
    // Un seul écran à deux vues (Rapports générés · Journal d'activité) : les comptages sont dans
    // Réconciliation, les bons validés dans Bons de commande (V3). Le menu ouvre la 1re vue — l'adresse
    // nue /stock/archives renvoie, elle, vers les comptages (anciens favoris).
    titre: "Archives",
    items: [
      { href: "/stock/archives?vue=rapports", label: "Archives", icone: "archives" },
    ],
  },
  {
    // « Utilisateurs » n'est plus au menu : c'est la rubrique du même nom de Paramètres (V3).
    titre: "Configuration",
    items: [
      { href: "/stock/imports", label: "Imports", icone: "importer", adminOnly: true },
      { href: "/parametres", label: "Paramètres", icone: "parametres", adminOnly: true },
    ],
  },
];

/**
 * Barre du bas (téléphone) — la journée du magasinier : le tableau de bord, l'Inventaire (les
 * quantités du dépôt, badge rouge des ruptures), « Mouvements » (le bouton ouvre l'entrée de menu
 * « Achats & mouvements » : ce qui entre et sort, liste d'achat, légumes du marché) et la Conso. journalière du restaurant, saisie
 * chaque jour. La Direction reçoit « À valider » à la place de la Conso. (V10). Bons de commande,
 * factures et fournisseurs suivent le rythme des livraisons : menu.
 */
export const BARRE_DU_BAS: CandidatBarre[] = [
  { href: "/stock", court: "Accueil" },
  { href: "/stock/catalogue", court: "Inventaire" },
  { href: ENTREE_MENU_ACHATS.href, court: "Mouvements" },
  { href: "/stock/a-valider", court: "À valider", roles: ["ADMIN"] },
  { href: "/stock/journalier", court: "Conso." },
];

/** État actif (menu et barre) : le tableau de bord sur son adresse exacte, « Achats & mouvements »
 *  sur ses trois sous-onglets, le reste sur le préfixe (de l'adresse SANS sa vue : `?vue=rapports`). */
export function lienActif(href: string, pathname: string): boolean {
  const chemin = href.split("?")[0];
  // La fiche d'un comptage (/stock/archives/<id>) appartient à Réconciliation, plus aux Archives.
  if (pathname.startsWith("/stock/archives/")) return chemin === "/stock/reconciliation";
  return chemin === ENTREE_MENU_ACHATS.href ? sousOngletActif(pathname) !== null // active sur ses trois sous-onglets
    : chemin === "/stock" ? pathname === chemin : pathname.startsWith(chemin);
}
