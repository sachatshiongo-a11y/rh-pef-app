// Navigation UNIFIÉE de l'espace « Gestion » (Ressources humaines + Stock & Achats).
// Utilisée à l'identique par les DEUX coquilles (app-shell côté RH, stock-shell côté Stock) :
// quel que soit le point d'entrée (/employes, /paie… ou /stock/*), l'utilisateur voit UNE seule
// barre groupée — les onglets RH d'un côté, les onglets Stock de l'autre. Les URLs restent
// INCHANGÉES : ce module ne fait que rassembler les liens existants dans une nav commune.
//
// Chaque item porte son domaine d'accès (`acces`) : les groupes RH ne s'affichent que pour un
// compte ayant l'accès RH, les groupes Stock que pour un compte ayant l'accès Stock. La Direction
// (ADMIN) voit tout. Le cloisonnement réel reste porté par les gardes serveur (layouts + requireModule) :
// masquer un lien ne suffit jamais, mais évite d'exposer des onglets inaccessibles.

export type NavAcces = "rh" | "stock";
export type NavItem = { href: string; label: string; icone: string; acces: NavAcces; adminOnly?: boolean };
export type NavGroupe = { titre: string; items: NavItem[] };

// Ordre : bloc RH (Essentiels → Temps de travail → Finances) puis bloc Stock (Pilotage → Dépôt →
// Restaurant → Achats), et une Configuration commune en pied. Les libellés et icônes reprennent
// à l'identique ceux des deux anciennes barres pour préserver l'harmonie visuelle.
export const NAV_GESTION: NavGroupe[] = [
  {
    titre: "Les essentiels",
    items: [
      { href: "/accueil", label: "Tableau de bord", icone: "accueil", acces: "rh" },
      { href: "/a-valider", label: "Demandes de validation", icone: "valider", acces: "rh", adminOnly: true },
      { href: "/employes", label: "Employés", icone: "employes", acces: "rh" },
      { href: "/fiches-poste", label: "Fiches de poste", icone: "document", acces: "rh" },
      { href: "/paie", label: "Paie", icone: "billet", acces: "rh" },
    ],
  },
  {
    titre: "Temps de travail",
    items: [
      { href: "/pointer", label: "Pointer", icone: "horloge", acces: "rh" },
      { href: "/planning", label: "Planning", icone: "calendrier", acces: "rh" },
      { href: "/presences", label: "Présences & heures", icone: "presence", acces: "rh" },
      { href: "/conges", label: "Congés & absences", icone: "parasol", acces: "rh" },
    ],
  },
  {
    titre: "Finances & archives",
    items: [
      { href: "/declarations", label: "Déclarations", icone: "recu", acces: "rh" },
      { href: "/documents", label: "Documents", icone: "dossier", acces: "rh" },
    ],
  },
  {
    titre: "Stock — Pilotage",
    items: [
      { href: "/stock", label: "Tableau de bord", icone: "accueil", acces: "stock" },
      { href: "/stock/a-valider", label: "Demandes à valider", icone: "valider", acces: "stock", adminOnly: true },
      { href: "/stock/archives", label: "Archives", icone: "archives", acces: "stock" },
    ],
  },
  {
    titre: "Stock — Dépôt",
    items: [
      { href: "/stock/catalogue", label: "Catalogue", icone: "marmite", acces: "stock" },
      { href: "/stock/entree", label: "Liste d'achat", icone: "panier", acces: "stock" },
      { href: "/stock/mouvements", label: "Mouvements", icone: "echanges", acces: "stock" },
      { href: "/stock/reconciliation", label: "Réconciliation", icone: "balance", acces: "stock" },
    ],
  },
  {
    titre: "Stock — Restaurant",
    items: [
      { href: "/stock/restaurant", label: "Stock restaurant", icone: "couverts", acces: "stock" },
      { href: "/stock/legumes", label: "Achats légumes frais", icone: "feuille", acces: "stock" },
      { href: "/stock/journalier", label: "Conso. journalière", icone: "calendrierJours", acces: "stock" },
    ],
  },
  {
    titre: "Stock — Achats",
    items: [
      { href: "/stock/commandes", label: "Bons de commande", icone: "presence", acces: "stock" },
      { href: "/stock/fournisseurs", label: "Fournisseurs", icone: "camion", acces: "stock" },
      { href: "/stock/factures", label: "Factures", icone: "recu", acces: "stock" },
    ],
  },
  {
    titre: "Configuration",
    items: [
      { href: "/parametres", label: "Paramètres RH", icone: "parametres", acces: "rh" },
      { href: "/stock/parametres", label: "Paramètres stock", icone: "parametres", acces: "stock" },
      { href: "/stock/imports", label: "Imports", icone: "importer", acces: "stock", adminOnly: true },
      { href: "/stock/utilisateurs", label: "Utilisateurs", icone: "employes", acces: "stock", adminOnly: true },
    ],
  },
];

/** Filtre la nav unifiée selon les accès du compte (RH / Stock) et le rôle (items réservés ADMIN).
 *  Les groupes qui n'ont plus d'item après filtrage sont retirés. */
export function filtrerNavGestion(
  groupes: NavGroupe[],
  { accesRH, accesStock, isAdmin }: { accesRH: boolean; accesStock: boolean; isAdmin: boolean },
): NavGroupe[] {
  return groupes
    .map((g) => ({
      titre: g.titre,
      items: g.items.filter(
        (it) => (it.acces === "rh" ? accesRH : accesStock) && (!it.adminOnly || isAdmin),
      ),
    }))
    .filter((g) => g.items.length > 0);
}
