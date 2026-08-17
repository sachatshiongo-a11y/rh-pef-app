import * as XLSX from "xlsx";

/**
 * Classeur SYNTHÉTIQUE reproduisant la structure réelle de « Fiche technique plats crash test.xlsx »
 * en trois onglets, avec ses pièges :
 *   - les deux fiches n'ont PAS la même mise en page (3 lignes d'écart) — un import ancré sur des
 *     coordonnées de cellule lirait du vide ;
 *   - la liste des articles a son entête décalée, et « Fournisseur » figure des deux côtés ;
 *   - la sous-recette est recopiée en « fausse ligne » dans la liste des articles ;
 *   - l'erreur de saisie ×10 sur les pennes est reproduite telle quelle.
 *
 * Partagé par le test du parseur et le test d'intégration du chemin d'écriture : les deux doivent
 * parler du MÊME classeur, sinon l'un valide ce que l'autre ne voit pas. Aucune donnée réelle de la
 * Direction n'est requise pour l'exécuter.
 */

function feuille(cellules: Record<string, string | number>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  for (const [adresse, v] of Object.entries(cellules)) {
    ws[adresse] = { t: typeof v === "number" ? "n" : "s", v };
  }
  const coords = Object.keys(cellules).map((a) => XLSX.utils.decode_cell(a));
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: Math.min(...coords.map((c) => c.r)), c: Math.min(...coords.map((c) => c.c)) },
    e: { r: Math.max(...coords.map((c) => c.r)), c: Math.max(...coords.map((c) => c.c)) },
  });
  return ws;
}

export { feuille };

/** Sous-recette « Sauce bolognaise 4.6 kg » : mise en page A (tableau à partir de la ligne 25). */
export const SAUCE_BOLOGNAISE = feuille({
  B9: "FICHE TECHNIQUE",
  B11: "Pâtes classiques",
  B13: "Sauce bolognaise 4.6 kg ",
  B15: "Nombre de portions :", C15: 23,
  B17: "Prix de vente TTC :", C17: 10.030610997460869,
  B18: "Taux TVA :", C18: 0.16,
  B25: "Article", C25: "Unité ", D25: "Unités nécessaires", E25: "Coût d'achat HT à l'unité", F25: "Prix de revient HT",
  B26: "Viande Hachée", C26: "Kg", D26: 2.2,
  B27: "Tomates pêlées 240g ", C27: "Pièce", D27: 5,
  B28: "Tomates concentrées", C28: "Pièce", D28: 3,
  B29: "Vin rouge", C29: "Bouteille", D29: 3,
  B30: "LAIT ELLE & VIRE ENTIER RED 1LTR", C30: "L", D30: 1.25,
  B31: "Huile 1L régina", C31: "L", D31: 0.13333,
  B32: "Carottes", C32: "kg", D32: 0.28,
  C33: 0, E33: 0, F33: 0, // lignes de remplissage du classeur : ignorées
  C34: 0, E34: 0, F34: 0,
  B37: "Total prix de revient HT", F37: 56.82365836,
  B40: "Coefficient de marge", F40: 3.5,
  B45: "Recette ",
});

/**
 * Plat « Bolognaise » : mise en page B, DÉCALÉE de 3 lignes par rapport à la sous-recette.
 * C'est exactement le piège du classeur réel (tableau ligne 21 sur une fiche, ligne 31 sur une
 * autre) : un import ancré sur « C15 »/« B26 » lirait ici des cellules vides.
 */
export const BOLOGNAISE = feuille({
  B12: "FICHE TECHNIQUE",
  B14: "Pâtes classiques",
  B16: "Bolognaise ",
  B18: "Nombre de portions :", C18: 1,
  B20: "Prix de vente TTC :", C20: 23.478399999999997,
  B21: "Taux TVA :", C21: 0.16,
  B28: "Article", C28: "Unité ", D28: "Unités nécessaires",
  B29: "Sauce bolognaise ", C29: "cl ", D29: 200,
  B30: "20 PENNE RIGATE LM CHEF 12 X 1KG", C30: "Kg", D30: 0.2,
  C31: 0, E31: 0, F31: 0,
  B34: "Total prix de revient HT", F34: 2.53,
  B37: "Coefficient de marge", F37: 8,
});

/** Liste des articles : entête DÉCALÉE en ligne 17, et « Fournisseur » présent des deux côtés. */
export const LISTE_ARTICLES = feuille({
  B15: "LISTE DES FOURNISSEURS", R15: "LISTE DES ARTICLES",
  B17: "Fournisseur", C17: "Produits", D17: "Téléphone",
  R17: "BARCODE", S17: "Désignation ", T17: "Unité", U17: "Quantité par paquet ",
  V17: "PRIX à l'unité ", W17: "PRIX CRT", X17: "FOURNISSEUR",
  B18: "SO GOOD", S18: "20 PENNE RIGATE LM CHEF 12 X 1KG", T18: "Kg", U18: 12, V18: 0.35, W18: 42, X18: "SO GOOD",
  B19: "REGAL", S19: "LAIT ELLE & VIRE ENTIER RED 1LTR", T19: "L", U19: 24, V19: 2.5, W19: 60, X19: "REGAL",
  S20: "Viande Hachée", T20: "Kg", U20: "Viande -Volaille-Poisson-Crustacé", V20: 8.07,
  S21: "Tomates pêlées 240g ", T21: "Pièce", V21: 1.34,
  S22: "Tomates concentrées", T22: "Pièce", V22: 0.21,
  S23: "Vin rouge", T23: "Bouteille", V23: 9,
  S24: "Huile 1L régina", T24: "L", V24: 2.492,
  S25: "Carottes", T25: "kg", V25: 4.58, W25: 0,
  // « Fausse ligne » : la Direction recopie ses sous-recettes dans la liste des articles.
  S26: "Sauce bolognaise ", T26: "cl ", V26: 0.0123, W26: 0,
});

export function classeurSynthetique(): XLSX.WorkBook {
  return {
    SheetNames: ["Sauce bolognaise", "Bolognaise", "Liste des articles"],
    Sheets: {
      "Sauce bolognaise": SAUCE_BOLOGNAISE,
      Bolognaise: BOLOGNAISE,
      "Liste des articles": LISTE_ARTICLES,
    },
  };
}
