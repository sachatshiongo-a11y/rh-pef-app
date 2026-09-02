// Helper partagé de formatage des montants (convention Bolimo, instaurée ici comme référence commune).
// Négatif = parenthèses + rouge, JAMAIS le signe « − » : le composant appelant colore en rouge
// quand `montantSigne(...).negatif` est vrai (le rouge est un signal, jamais décoratif).

/**
 * Intl fr-FR sépare les milliers par une espace fine insécable (U+202F).
 * Optima, la police embarquée dans nos PDF, n'a AUCUN glyphe pour ce caractère : react-pdf se
 * rabat alors sur une police standard (Helvetica), qui dessine à la place une barre oblique
 * collée au chiffre suivant — d'où les montants « barrés » du bon de commande 018/PEF/SO/AOÛT/26
 * (« 1 049,76 $ » imprimé avec une barre en travers du 0). Tout montant ≥ 1 000 était touché,
 * sur les bons de commande comme sur les bulletins, contrats, attestations et rapports.
 * On normalise donc en espace ordinaire, présente dans toutes les polices.
 */
export const normaliserEspaces = (s: string) => s.replace(/[   ]/g, " ");
const norm = normaliserEspaces;

/**
 * Formatage fr-FR d'un nombre QUELCONQUE (quantité, heures, cartons…), espaces normalisées.
 * À utiliser partout où le texte finit dans un PDF : jamais `toLocaleString("fr-FR")` en direct.
 */
export function formaterNombre(n: number, options: Intl.NumberFormatOptions = {}): string {
  return norm(new Intl.NumberFormat("fr-FR", options).format(n));
}

const nf = (min: number, max: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });

export function formaterUSD(n: number): string {
  return `${norm(nf(2, 2).format(Math.abs(n)))} $`;
}

export function formaterFC(n: number): string {
  return `${norm(nf(0, 0).format(Math.abs(n)))} FC`;
}

export function formaterMontant(n: number, devise: "USD" | "CDF"): string {
  return devise === "USD" ? formaterUSD(n) : formaterFC(n);
}

export function montantSigne(n: number, devise: "USD" | "CDF"): { texte: string; negatif: boolean } {
  const negatif = n < 0;
  const base = formaterMontant(n, devise);
  return { texte: negatif ? `(${base})` : base, negatif };
}
