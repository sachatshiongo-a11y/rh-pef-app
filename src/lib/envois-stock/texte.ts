// MISE EN FORME DES COURRIELS AUTOMATIQUES DU STOCK (2026-10-12) — module PUR (ni base, ni horloge).
//
// Même présentation que les rappels RH (`app/api/cron/alertes`, `rapport-mensuel`) : texte brut, une puce par
// ligne, le lien sur la ligne suivante précédé de « → », un titre en capitales par rubrique. Une ligne = un
// objet (article, facture, bon…) ET le lien de l'écran qui le montre : rien n'est écrit sans son lien.
//
// Aucun chiffre n'est calculé ici : les modules `quotidien.ts` / `mensuel.ts` appellent les fonctions qui
// alimentent les écrans du Stock et ne font que ranger leur résultat. Un montant inconnu s'écrit « — ».

import { lienAbsolu } from "./liens";

/** Une ligne de courriel : son texte, et l'adresse RELATIVE de l'écran qui la montre. */
export type Ligne = { texte: string; lien: string };

/** Un sous-ensemble titré d'une rubrique (par domaine, par nature de demande, par fournisseur…). */
export type Groupe = { titre?: string; lignes: Ligne[]; omises?: { nombre: number; lien: string } };

export type Rubrique = {
  /** Clé stable (tests, journal) : « alertes », « factures », « dlc »… */
  cle: string;
  titre: string;
  /** Nombre d'éléments à signaler (compte les éléments, pas les lignes affichées). Absent : rubrique de synthèse, sans compte. */
  nombre?: number;
  /** Phrase de synthèse sous le titre (totaux, mises en garde « partiel »…). */
  resume?: string;
  groupes: Groupe[];
  /** Lien « voir tout » de la rubrique. */
  suite?: { libelle: string; lien: string };
};

/** Nombre maximal de lignes montrées par groupe : au-delà, « … et N autre(s) » avec le lien de la liste complète (jamais coupé en silence). */
export const LIGNES_MAX = 20;

/** Garde les `max` premières lignes ; le reste est DIT (`omises`), avec le lien de la liste complète. */
export function plafonner(lignes: Ligne[], lienListe: string, max: number = LIGNES_MAX): Pick<Groupe, "lignes" | "omises"> {
  if (lignes.length <= max) return { lignes };
  return { lignes: lignes.slice(0, max), omises: { nombre: lignes.length - max, lien: lienListe } };
}

const puce = (l: Ligne) => `• ${l.texte}\n  → ${lienAbsolu(l.lien)}`;

/** Une rubrique en texte brut. */
export function rendreRubrique(r: Rubrique): string {
  const bloc: string[] = [r.nombre === undefined ? r.titre.toUpperCase() : `${r.titre.toUpperCase()} — ${r.nombre}`];
  if (r.resume) bloc.push(r.resume);
  for (const g of r.groupes) {
    bloc.push("");
    if (g.titre) bloc.push(g.titre);
    if (g.lignes.length > 0) bloc.push(g.lignes.map(puce).join("\n"));
    if (g.omises) bloc.push(`… et ${g.omises.nombre} autre(s) : ${lienAbsolu(g.omises.lien)}`);
  }
  if (r.suite) bloc.push("", `${r.suite.libelle} : ${lienAbsolu(r.suite.lien)}`);
  return bloc.join("\n");
}

/** Le courriel entier : formule d'ouverture, rubriques séparées d'une ligne vide, lien de connexion. */
export function rendreCourriel(ouverture: string, rubriques: Rubrique[], pied: string[] = []): string {
  return [
    "Bonjour,",
    "",
    ouverture,
    "",
    rubriques.map(rendreRubrique).join("\n\n"),
    ...(pied.length ? ["", ...pied] : []),
    "",
    `Se connecter : ${lienAbsolu("/stock")}`,
  ].join("\n");
}
