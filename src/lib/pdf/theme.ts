// Palette inspirée du logo Pâtes en Folie (brun/or), en tons plus clairs pour un rendu épuré.
export const pdfColors = {
  brown: "#8B5E3C",
  brownDark: "#5A3B24",
  brownLight: "#C9A688",
  gold: "#D9A75C",
  goldLight: "#E9C68C",
  cream: "#FBF6EF",
  text: "#2E2013",
  textMuted: "#7A6A5C",
  border: "#E7DACB",
};

/** Formate un montant CDF sans décimales, avec espace normal comme séparateur de milliers
 * (la police PDF ne rend pas correctement l'espace insécable utilisé par défaut par fr-FR). */
export function formatCDF(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export type Devise = "USD" | "CDF";

/** Convertit et formate un montant (stocké en USD) dans la devise demandée du bulletin. */
export function formatMontant(montantUSD: number, devise: Devise, tauxChangeCDF: number): string {
  if (devise === "USD") {
    return (
      montantUSD.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
      " $"
    );
  }
  return formatCDF(montantUSD * tauxChangeCDF) + " CDF";
}

export const entreprise = {
  nom: "TOLYA SARL",
  enseigne: "Pâtes en Folie",
  telephone: "+243 (0) 83 000 34 23",
  email: "info@patesenfolie.cd",
  site: "www.patesenfolie.cd",
  adresse: "31, avenue Comité Urbain - Gombe - Kinshasa",
  // Adresse du restaurant (lieu de travail effectif), distincte du siège social.
  lieuTravail: "10, avenue Wagenia - CTC Mall - Kinshasa",
  pays: "République Démocratique du Congo",
  compteEcobank: "350 800 593 68 - 25 US$",
  rccm: "CD/KNG/RCCM/18-B-01373",
  idNat: "01-F4300-N74832J",
  numImpot: "A1820933",
};
