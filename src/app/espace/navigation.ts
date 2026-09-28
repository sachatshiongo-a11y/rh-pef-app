// LA NAVIGATION DE L'ESPACE SALARIÉ — une seule liste, lue par le menu, la barre du bas et l'Accueil
// (lot 6, 2026-09-28). Avant : dix entrées à plat dans un tiroir, et une douzaine de libellés qui
// différaient d'un endroit à l'autre (« Congés » / « Mes congés », « Dossier » / « Mon dossier »…).
//
// Sur téléphone, les quatre gestes du quotidien vivent dans la barre du bas, toujours sous le
// pouce ; le reste est rangé en trois groupes dans le menu.

export type LienEspace = {
  href: string;
  icone: string;
  /** Libellé du menu et des tuiles de l'Accueil. */
  label: string;
  /** Libellé court de la barre du bas (≤ 9 caractères). */
  court?: string;
  /** Ce qu'on y fait, pour la tuile de l'Accueil. */
  desc: string;
};

export type GroupeEspace = { titre: string; liens: LienEspace[] };

export const ACCUEIL: LienEspace = { href: "/espace", icone: "accueil", label: "Accueil", court: "Accueil", desc: "" };

export const GROUPES_ESPACE: GroupeEspace[] = [
  {
    titre: "Mon travail",
    liens: [
      { href: "/espace/pointer", icone: "horloge", label: "Pointer", court: "Pointer", desc: "Scanner l'affiche à l'arrivée et au départ" },
      { href: "/espace/planning", icone: "calendrier", label: "Mon planning", court: "Planning", desc: "Mes services et mes heures" },
      { href: "/espace/echanges", icone: "echanges", label: "Échanger un shift", desc: "Avec un collègue, ou changer d'horaire" },
    ],
  },
  {
    titre: "Congés et paie",
    liens: [
      { href: "/espace/conges", icone: "parasol", label: "Mes congés", court: "Congés", desc: "Mon solde, demander un congé" },
      { href: "/espace/paie", icone: "billet", label: "Ma paie", desc: "Mon salaire du mois, demander un acompte" },
    ],
  },
  {
    titre: "Mes papiers",
    liens: [
      { href: "/espace/documents", icone: "document", label: "Mes bulletins et documents", desc: "Bulletins de paie, envoyer un certificat" },
      { href: "/espace/contrats", icone: "mallette", label: "Mes contrats", desc: "Lire, signer, télécharger" },
      { href: "/espace/attestations", icone: "recu", label: "Mes attestations", desc: "En demander une, la télécharger" },
      { href: "/espace/dossier", icone: "dossier", label: "Mes informations", desc: "Poste, contrat, coordonnées" },
    ],
  },
];

/** Tous les liens, Accueil compris, dans l'ordre du menu. */
export const LIENS_ESPACE: LienEspace[] = [ACCUEIL, ...GROUPES_ESPACE.flatMap((g) => g.liens)];

/** La barre du bas (téléphone) : les gestes du quotidien. Le cinquième bouton ouvre le menu. */
export const BARRE_DU_BAS: LienEspace[] = LIENS_ESPACE.filter((l) => l.court);

/** Lien actif : l'Accueil seulement sur /espace, les autres sur leur préfixe. */
export function lienActif(href: string, pathname: string): boolean {
  return href === "/espace" ? pathname === "/espace" : pathname === href || pathname.startsWith(`${href}/`);
}
