// NAVIGATION DES ESPACES DE BUREAU (RH, Stock, Exploitation) — types et choix de la barre du bas.
// Module PUR (ni React ni session) : les menus de chaque espace vivent dans leur `navigation.ts`,
// que lisent à la fois la coquille (menu + barre du bas) et les garde-fous.
//
// Barre du bas (téléphone, 2026-09-29) : quatre écrans du quotidien + un bouton « Menu » qui ouvre
// le tiroir complet. Chaque espace déclare une liste ORDONNÉE de candidats ; on garde les quatre
// premiers que le rôle a le droit de voir. Ainsi un Responsable RH, qui n'a pas « Demandes de
// validation » (réservé Direction), reçoit l'entrée suivante au lieu d'un trou dans la barre.

export type EntreeMenu = { href: string; label: string; icone: string; adminOnly?: boolean };
export type GroupeMenu = { titre: string; items: EntreeMenu[] };

/** Un candidat de la barre du bas : un écran DU MENU (même adresse) et son libellé court. */
export type CandidatBarre = { href: string; court: string };

/** Ce que la barre du bas affiche pour une entrée. */
export type EntreeBarre = { href: string; icone: string; court: string; badge?: number };

/** Nombre d'écrans dans la barre ; le cinquième bouton est « Menu ». */
export const ENTREES_BARRE_MAX = 4;

/** Les entrées du menu visibles pour ce rôle (les entrées « Direction » sont masquées aux autres). */
export function entreesVisibles(items: EntreeMenu[], role: string): EntreeMenu[] {
  return items.filter((it) => !it.adminOnly || role === "ADMIN");
}

/**
 * Les entrées de la barre du bas pour un rôle : les candidats, dans leur ordre, qui existent dans le
 * menu ET que le rôle voit — quatre au plus. L'icône vient du menu : une seule source.
 */
export function choisirBarreDuBas(
  groupes: GroupeMenu[],
  candidats: CandidatBarre[],
  role: string,
  badges: Record<string, number> = {},
): EntreeBarre[] {
  const visibles = new Map(entreesVisibles(groupes.flatMap((g) => g.items), role).map((it) => [it.href, it]));
  const out: EntreeBarre[] = [];
  for (const c of candidats) {
    const it = visibles.get(c.href);
    if (!it) continue;
    out.push({ href: c.href, icone: it.icone, court: c.court, badge: badges[c.href] ?? 0 });
    if (out.length === ENTREES_BARRE_MAX) break;
  }
  return out;
}
