import type { EcartExport, RoleCol, partiesPdfComparaison } from "@/lib/journalier-restaurant";
import type { PartieComparaison, StyleCellule } from "@/lib/pdf/comparaison";

// Habillage des exports (PDF, Excel) de la Comparaison : quelle couleur, quel fond, quel écart signé pour chaque
// cellule. Pur (aucune lecture de base) pour être vérifié sans rendre le PDF. Les VALEURS viennent
// de `lignesExportComparaison`, inchangées ; ici on ne fait que les vêtir.

// Vert = commande, rouge = livraison (codes couleur de la fiche), indigo = consommé au restaurant.
export const COULEUR_ROLE: Record<string, string> = { cmd: "#1B7F3B", liv: "#B42318", conso: "#3730A3" };
/** Fond de l'écart et couleur (foncée) de son signe : orange = livré ≠ commandé, bleu = livré non consommé, violet = consommé en trop. */
export const ECART_PDF = {
  LIVRE_DIFFERE: { fond: "#FDE8D3", signe: "#9A3412" },
  LIVRE_NON_CONSOMME: { fond: "#D9ECFA", signe: "#0B5E8E" },
  CONSOMME_PLUS_QUE_LIVRE: { fond: "#E8E0FA", signe: "#5B21B6" },
} as const;

export type DonneesPdfComparaison = {
  lignes: string[][];
  sectionRows: number[];
  colRole: RoleCol[];
  ecarts: Set<string>;
  ecartsCL: Set<string>;
  signes: Map<string, EcartExport>;
};

/** Style d'UNE cellule de l'export (ligne `r`, colonne `c` de l'export complet). */
export function styleCellulePdf(d: DonneesPdfComparaison, r: number, c: number): StyleCellule {
  if (c === 0) return {};
  const cle = `${r}:${c}`;
  const role = d.colRole[c] ?? null;
  const couleur = role ? COULEUR_ROLE[role] : undefined;
  const signe = d.signes.get(cle);
  const total = c > d.colRole.length - 4; // les trois dernières colonnes : « Total »
  if (signe) {
    const ton = ECART_PDF[signe.nature];
    return { couleur, gras: true, fond: ton.fond, signe: signe.signe, couleurSigne: ton.signe };
  }
  if (d.ecartsCL.has(cle)) return { couleur, gras: true, fond: ECART_PDF.LIVRE_DIFFERE.fond };
  // Consommé connu et nul : présent mais discret. « — » (inconnu) garde la couleur du rôle.
  if (role === "conso" && d.lignes[r]?.[c] === "0") return { discret: true };
  return { couleur, gras: total };
}

/** Les parties du document, prêtes pour `ComparaisonDocument` (mêmes lignes que l'export, découpées par colonnes). */
export function partiesDocumentComparaison(d: DonneesPdfComparaison, parties: ReturnType<typeof partiesPdfComparaison>): PartieComparaison[] {
  return parties.map((p) => ({
    titre: p.titre, groupes: p.groupes, colonnes: p.colonnes, sectionRows: d.sectionRows,
    lignes: d.lignes.map((l) => p.indices.map((i) => l[i] ?? "")),
    cellule: (r, c) => styleCellulePdf(d, r, p.indices[c]!),
  }));
}

/** Pied de page : la légende, en une phrase. */
export const PIED_PDF_COMPARAISON =
  "Cmd : commandé. Livré : livré au restaurant. Conso : consommé au restaurant (comptages ; « — » : jour sans comptage). " +
  "Fond bleu et -n : livré non consommé. Fond violet et +n : consommé plus que livré. Fond orange et +n / -n : livré différent du commandé.";

// ─── Excel ───────────────────────────────────────────────────────────────────

const ARGB_ROLE: Record<string, string> = { cmd: "FF1B7F3B", liv: "FFB42318", conso: "FF3730A3" };
const ARGB_BANDE = "FFF6EFE4"; // un jour sur deux
const ARGB_FOND = { LIVRE_DIFFERE: "FFFDE8D3", LIVRE_NON_CONSOMME: "FFD9ECFA", CONSOMME_PLUS_QUE_LIVRE: "FFE8E0FA" } as const;

/**
 * Feuille Excel de la Comparaison : les valeurs de l'export, l'écart signé écrit à côté de la valeur
 * (« 6 (-1) ») pour ne pas dépendre de la couleur, les jours alternés de fond, un filet marqué entre
 * deux jours, deux niveaux d'en-tête. Aucun autofiltre : les lignes-titres de rubrique se mélangeraient au tri.
 */
export function feuilleExcelComparaison(d: DonneesPdfComparaison & { enteteCourt: string[]; groupesEntete: { libelle: string; debut: number; nb: number }[] }) {
  const lignes = d.lignes.map((l, r) => l.map((v, c) => { const e = d.signes.get(`${r}:${c}`); return e ? `${v} (${e.signe})` : v; }));
  const groupe = (c: number) => (c === 0 ? -1 : Math.floor((c - 1) / 3));
  const nbCols = d.enteteCourt.length;
  return {
    entete: d.enteteCourt,
    lignes,
    sectionRows: d.sectionRows,
    groupesEntete: d.groupesEntete,
    figerColonnes: 1,
    filetGaucheCols: d.groupesEntete.map((g) => g.debut),
    alignerADroite: Array.from({ length: nbCols - 1 }, (_, i) => i + 1),
    fondCellule: (r: number, c: number) => {
      const e = d.signes.get(`${r}:${c}`);
      if (e) return ARGB_FOND[e.nature];
      if (d.ecartsCL.has(`${r}:${c}`)) return ARGB_FOND.LIVRE_DIFFERE;
      return groupe(c) % 2 === 1 ? ARGB_BANDE : undefined;
    },
    couleurTexteCellule: (r: number, c: number) => (c === 0 ? undefined : ARGB_ROLE[d.colRole[c] ?? ""]),
  };
}
