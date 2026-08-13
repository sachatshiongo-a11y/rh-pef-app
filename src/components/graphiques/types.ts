// Types partagés des graphiques SVG maison (Task Graphiques) — AUCUNE dépendance de graphes
// (pas de recharts) : tout est du SVG dessiné à la main par `graphique-cartesien.tsx` +
// `serie-ligne.tsx` + `serie-barres.tsx`.

export type ValeurSerie = number | null;

export type SerieLigneConfig = {
  cle: string;
  label: string;
  type: "ligne";
  /** Valeur CSS de couleur (ex. `"var(--chart-vert)"`) — jamais une classe Tailwind (les
   *  couleurs de série sont des variables CSS propres au module, pas enregistrées dans
   *  `@theme inline`, donc résolues via `style`, pas via une classe utilitaire). */
  couleur: string;
  /** Ligne de référence (ex. seuil de rentabilité) — tracé en pointillés. */
  pointille?: boolean;
  valeurs: ValeurSerie[];
  /** Affiche la valeur du dernier point connu à côté du tracé (texte en ENCRE NEUTRE, jamais la
   *  couleur de la série — cf. règle dataviz). */
  libelleDirect?: boolean;
  /** Indices de mois à marquer avec `couleurMarqueur` au lieu de `couleur` (ex. CA sous le seuil). */
  marquerIndices?: number[];
  couleurMarqueur?: string;
};

export type SerieBarresConfig = {
  cle: string;
  label: string;
  type: "barres";
  /** Couleur PAR BARRE (ex. vert si résultat ≥ 0, rouge sinon). */
  couleur: (valeur: number, index: number) => string;
  valeurs: ValeurSerie[];
};

export type SerieConfig = SerieLigneConfig | SerieBarresConfig;

export type BandeReference = { valeur: number; etiquette?: string };
