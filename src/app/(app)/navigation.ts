// LA NAVIGATION DE L'ESPACE RH — une seule liste, lue par le menu (tiroir sur téléphone, barre
// latérale sur ordinateur) et par la barre du bas. Menu groupé façon PayFit : sections + icônes.
import type { CandidatBarre, GroupeMenu } from "@/lib/navigation-espaces";

export const NAV_GROUPS: GroupeMenu[] = [
  {
    titre: "Les essentiels",
    items: [
      { href: "/accueil", label: "Tableau de bord", icone: "accueil" },
      { href: "/a-valider", label: "Demandes de validation", icone: "valider", adminOnly: true },
      { href: "/employes", label: "Employés", icone: "employes" },
      { href: "/fiches-poste", label: "Fiches de poste", icone: "document" },
      { href: "/paie", label: "Paie", icone: "billet" },
    ],
  },
  {
    titre: "Temps de travail",
    items: [
      { href: "/pointer", label: "Pointer", icone: "horloge" },
      { href: "/planning", label: "Planning", icone: "calendrier" },
      { href: "/presences", label: "Présences & heures", icone: "presence" },
      { href: "/conges", label: "Congés & absences", icone: "parasol" },
    ],
  },
  {
    titre: "Finances & archives",
    items: [
      { href: "/declarations", label: "Déclarations", icone: "recu" },
      { href: "/documents", label: "Documents", icone: "dossier" },
    ],
  },
  {
    titre: "Configuration",
    items: [{ href: "/parametres", label: "Paramètres", icone: "parametres" }],
  },
];

/**
 * Barre du bas (téléphone) — les gestes quotidiens de la RH d'un restaurant : le tableau de bord,
 * la saisie des présences (chaque jour, elle alimente la paie), le planning de la brigade, puis la
 * pile de demandes à trancher (congés, acomptes, changements de shift — badge rouge). « Demandes de
 * validation » étant réservé à la Direction, un Responsable RH reçoit à la place « Congés », qui
 * porte le badge des congés en attente.
 */
export const BARRE_DU_BAS: CandidatBarre[] = [
  { href: "/accueil", court: "Accueil" },
  { href: "/presences", court: "Présences" },
  { href: "/planning", court: "Planning" },
  { href: "/a-valider", court: "À valider" },
  { href: "/conges", court: "Congés" },
];

/** État actif (menu et barre) : le tableau de bord sur son adresse exacte, le reste sur le préfixe. */
export function lienActif(href: string, pathname: string): boolean {
  return href === "/accueil" ? pathname === href : pathname.startsWith(href);
}
