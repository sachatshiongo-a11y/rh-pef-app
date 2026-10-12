// FICHE ARTICLE — onglets et filtres, règles partagées (demande de la Direction, 2026-10-12 :
// « agencer la fiche article comme la fiche fournisseur »). Même patron que lib/fiche-fournisseur.ts.
//
// Module pur (ni base, ni `server-only`) : lu par la page et par ses tests. L'onglet et le filtre
// vivent DANS L'URL (`?onglet=mouvements&filtre=sorties`) : un lien, un favori ou un rechargement
// retombent exactement là où on était. `?mouvements=tous` et `?prix=tous` (« Voir les plus anciens »)
// restent des paramètres à part et sont conservés d'un lien à l'autre. L'année et le mois de l'onglet Mouvements
// (`?annee=2026&mois=10`, demande de la Direction du 2026-10-12) se combinent avec le filtre : chaque lien les garde.

export const ONGLETS_ARTICLE = ["mouvements", "fournisseurs", "fiches", "prix", "informations"] as const;
export type OngletArticle = (typeof ONGLETS_ARTICLE)[number];
export const ONGLET_ARTICLE_PAR_DEFAUT: OngletArticle = "mouvements";

export const FILTRES_MOUVEMENTS = ["entrees", "sorties", "ajustements", "tous"] as const;
export type FiltreMouvements = (typeof FILTRES_MOUVEMENTS)[number];
export const FILTRE_MOUVEMENTS_PAR_DEFAUT: FiltreMouvements = "tous";

/** Un paramètre d'URL peut arriver en tableau (`?a=1&a=2`) : on ne retient que la première valeur. */
const premier = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** `?onglet=` : valeur absente ou inconnue → Mouvements. */
export function lireOngletArticle(v: string | string[] | undefined): OngletArticle {
  const x = premier(v);
  return (ONGLETS_ARTICLE as readonly string[]).includes(x ?? "") ? (x as OngletArticle) : ONGLET_ARTICLE_PAR_DEFAUT;
}

/** `?filtre=` (onglet Mouvements) : valeur absente ou inconnue → Tous. */
export function lireFiltreMouvements(v: string | string[] | undefined): FiltreMouvements {
  const x = premier(v);
  return (FILTRES_MOUVEMENTS as readonly string[]).includes(x ?? "") ? (x as FiltreMouvements) : FILTRE_MOUVEMENTS_PAR_DEFAUT;
}

/** Type de mouvement (colonne `MouvementStock.type`) porté par un filtre ; `undefined` = tous. */
export function typeDuFiltre(f: FiltreMouvements): "ENTREE" | "SORTIE" | "AJUSTEMENT" | undefined {
  return f === "entrees" ? "ENTREE" : f === "sorties" ? "SORTIE" : f === "ajustements" ? "AJUSTEMENT" : undefined;
}

/** Adresse d'un onglet de la fiche — toujours explicite (`?onglet=`), jamais « la racine » : elle reste valable si le défaut change. */
export function lienFicheArticle(
  articleId: string,
  onglet: OngletArticle,
  opts: { filtre?: FiltreMouvements; annee?: number | "toutes"; mois?: number | null; tousMouvements?: boolean; tousPrix?: boolean } = {},
): string {
  const p = new URLSearchParams({ onglet });
  if (onglet === "mouvements") {
    if (opts.annee !== undefined) {
      p.set("annee", String(opts.annee));
      if (opts.annee !== "toutes" && opts.mois) p.set("mois", String(opts.mois));
    }
    if (opts.filtre && opts.filtre !== FILTRE_MOUVEMENTS_PAR_DEFAUT) p.set("filtre", opts.filtre);
    if (opts.tousMouvements) p.set("mouvements", "tous");
  }
  if (onglet === "prix" && opts.tousPrix) p.set("prix", "tous");
  return `/stock/catalogue/${articleId}?${p}`;
}
