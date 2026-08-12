// Helper partagé de formatage des montants (convention Bolimo, instaurée ici comme référence commune).
// Négatif = parenthèses + rouge, JAMAIS le signe « − » : le composant appelant colore en rouge
// quand `montantSigne(...).negatif` est vrai (le rouge est un signal, jamais décoratif).

// Intl fr-FR sépare les milliers par une espace fine insécable (U+202F) : on la normalise en espace simple.
const norm = (s: string) => s.replace(/[  ]/g, " ");
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
