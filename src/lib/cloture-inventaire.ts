import "server-only";
import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_LABEL } from "@/lib/stock";

// Inventaire valorisé : chaque article avec sa catégorie, son fournisseur, son statut de
// réapprovisionnement, sa quantité et sa valeur (quantité × prix de référence), regroupé par
// domaine (Nourriture / Boissons / Autre). Utilisé pour l'export d'une clôture.

export type LigneInventaire = {
  articleId: string; code: string; designation: string; domaine: string; unite: string;
  categorie: string; fournisseur: string; quantite: number; stockMinimum: number; prixUnitaireUSD: number;
};
export type Inventaire = {
  fige: boolean; // true = instantané figé à la clôture ; false = état actuel du stock
  valeurTotaleUSD: number;
  lignes: LigneInventaire[];
};

export const DOMAINES = ["NOURRITURE", "BOISSON", "AUTRE"] as const;
export const DOMAINE_LABEL: Record<string, string> = { NOURRITURE: "Nourriture", BOISSON: "Boissons", AUTRE: "Autre" };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Statut de réapprovisionnement lisible (Urgent / À réapprovisionner / Satisfaisant). */
export const alerteLabel = (quantite: number, stockMinimum: number) => ALERTE_LABEL[niveauAlerte(quantite, stockMinimum)];

/** Construit l'inventaire à partir de l'état ACTUEL du stock (articles actifs). */
export async function inventaireActuel(): Promise<Inventaire> {
  const articles = await prisma.articleStock.findMany({
    where: { actif: true },
    select: {
      id: true, code: true, designation: true, domaine: true, unite: true,
      prixUnitaireUSD: true,
      categorie: { select: { nom: true } },
      fournisseur: { select: { nom: true } },
      stock: { select: { quantite: true, stockMinimum: true } },
    },
  });
  const lignes: LigneInventaire[] = articles.map((a) => ({
    articleId: a.id,
    code: a.code ?? "",
    designation: a.designation,
    domaine: String(a.domaine),
    unite: a.unite ?? "",
    categorie: a.categorie?.nom ?? "",
    fournisseur: a.fournisseur?.nom ?? "",
    quantite: a.stock ? Number(a.stock.quantite) : 0,
    stockMinimum: a.stock ? Number(a.stock.stockMinimum) : 0,
    prixUnitaireUSD: a.prixUnitaireUSD ? Number(a.prixUnitaireUSD) : 0,
  }));
  const valeurTotaleUSD = r2(lignes.reduce((t, l) => t + l.quantite * l.prixUnitaireUSD, 0));
  return { fige: false, valeurTotaleUSD, lignes };
}

/** Sérialise l'inventaire actuel pour le figer dans ClotureStock.snapshot. */
export async function snapshotActuel() {
  const inv = await inventaireActuel();
  return { valeurTotaleUSD: inv.valeurTotaleUSD, lignes: inv.lignes };
}

/**
 * Inventaire d'un mois : l'instantané figé à la clôture s'il existe (et contient le format enrichi),
 * sinon l'état actuel (mois non clôturé, ou clôturé avant l'enrichissement de l'instantané).
 */
export async function inventaireDuMois(annee: number, mois: number): Promise<Inventaire> {
  const cloture = await prisma.clotureStock.findUnique({ where: { annee_mois: { annee, mois } } });
  const snap = cloture?.snapshot as { valeurTotaleUSD?: number; lignes?: LigneInventaire[] } | null | undefined;
  // On n'utilise l'instantané que s'il porte le format enrichi (présence d'articleId).
  if (snap?.lignes && snap.lignes.length > 0 && "articleId" in snap.lignes[0]) {
    return { fige: true, valeurTotaleUSD: r2(snap.valeurTotaleUSD ?? snap.lignes.reduce((t, l) => t + l.quantite * l.prixUnitaireUSD, 0)), lignes: snap.lignes };
  }
  return inventaireActuel();
}

/** Regroupe et trie les lignes par domaine, avec sous-total de valeur par domaine. */
export function parDomaine(inv: Inventaire) {
  return DOMAINES.map((dom) => {
    const lignes = inv.lignes.filter((l) => l.domaine === dom).sort((a, b) => a.designation.localeCompare(b.designation, "fr"));
    const valeur = r2(lignes.reduce((t, l) => t + l.quantite * l.prixUnitaireUSD, 0));
    return { domaine: dom, label: DOMAINE_LABEL[dom], lignes, valeur };
  });
}
