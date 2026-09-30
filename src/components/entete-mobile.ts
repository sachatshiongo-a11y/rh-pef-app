/**
 * En-tête de la coquille sur téléphone (sous `lg`) et ce qui se cale dessous — UNE règle pour tous
 * les espaces (salarié, RH, Stock, Exploitation) : toute barre COLLANTE d'une page (barre d'actions
 * groupées, sous-onglets, en-tête de colonnes) se colle SOUS cet en-tête, jamais derrière lui, et
 * jamais sous la barre du bas (les coquilles réservent sa place, cf. RESERVE_BARRE_DU_BAS).
 *
 * Le mécanisme :
 *   - la coquille pose la variable CSS `--hauteur-entete` sur son conteneur (`HAUTEUR_ENTETE`) ;
 *   - son en-tête a EXACTEMENT cette hauteur (`ENTETE_COLLANT`, `h-[var(--hauteur-entete)]`) : la
 *     valeur n'est pas mesurée, elle est imposée (`shrink-0` : dans un <main> flex en colonne, sans lui
 *     l'en-tête RÉTRÉCIT d'un pixel dès que la page est longue) — pas de JavaScript, pas de saut à l'hydratation,
 *     et l'encoche de l'iPhone (`env(safe-area-inset-top)`) est comptée une seule fois, ici ;
 *   - une barre de page se colle par la classe `colle-sous-entete` (globals.css) : `top: 0` sur
 *     ordinateur (comportement d'origine), `top: var(--hauteur-entete)` sous `lg`. Sans coquille
 *     (page hors espace), la variable est absente et le repli est 0px.
 * Ne JAMAIS recopier la hauteur dans une page (`top-[calc(… + 52px)]`) : elle dérive dès que l'en-tête
 * change. Le garde-fou `entete-mobile.garde-fou.test.ts` refuse tout `sticky top-N` dans le contenu.
 *
 * Empilement : l'en-tête (35) reste au-dessus de tout le contenu (barres collantes 20, coins de
 * tableaux 30) et de la barre du bas (30) ; le voile du tiroir (40) et le tiroir (50) passent
 * au-dessus de lui. Ni `backdrop-filter` ni fond translucide sur cet élément collant (piège PWA iOS).
 */

/** Hauteur de l'en-tête « Direction » (RH, Stock, Exploitation) : 44 px + l'encoche (au moins 8 px). */
export const HAUTEUR_ENTETE = "[--hauteur-entete:calc(max(0.5rem,env(safe-area-inset-top))_+_2.75rem)]";

/** Hauteur de l'en-tête de l'espace salarié (pastille de 36 px + logo) : 48 px + l'encoche. Cet en-tête reste
 *  visible sur ordinateur, où `colle-sous-entete` ne décale pas : aucune page de l'espace n'a de barre collante
 *  aujourd'hui ; en ajouter une demanderait d'étendre le décalage à `lg` pour cet espace. */
export const HAUTEUR_ENTETE_ESPACE = "[--hauteur-entete:calc(max(0.5rem,env(safe-area-inset-top))_+_3rem)]";

/** Le socle de l'en-tête collant de toutes les coquilles ; chacune y ajoute `flex`, ses marges et sa visibilité. */
export const ENTETE_COLLANT =
  "sticky top-0 z-[35] box-border h-[var(--hauteur-entete)] shrink-0 items-center gap-2 border-b bg-background pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]";
