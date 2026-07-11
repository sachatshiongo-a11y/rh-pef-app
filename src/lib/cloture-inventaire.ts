import "server-only";
import { prisma } from "@/lib/prisma";

// Inventaire valorisé : quantité et valeur (quantité × prix de référence) de chaque article,
// regroupé par domaine (Nourriture / Boissons / Autre). Utilisé pour l'export d'une clôture.

export type LigneInventaire = { designation: string; domaine: string; quantite: number; prixUnitaireUSD: number };
export type Inventaire = {
  fige: boolean; // true = instantané figé à la clôture ; false = état actuel du stock
  valeurTotaleUSD: number;
  lignes: LigneInventaire[];
};

export const DOMAINES = ["NOURRITURE", "BOISSON", "AUTRE"] as const;
export const DOMAINE_LABEL: Record<string, string> = { NOURRITURE: "Nourriture", BOISSON: "Boissons", AUTRE: "Autre" };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Construit l'inventaire à partir de l'état ACTUEL du stock (articles actifs). */
export async function inventaireActuel(): Promise<Inventaire> {
  const articles = await prisma.articleStock.findMany({
    where: { actif: true },
    select: { designation: true, domaine: true, prixUnitaireUSD: true, stock: { select: { quantite: true } } },
  });
  const lignes: LigneInventaire[] = articles.map((a) => ({
    designation: a.designation,
    domaine: String(a.domaine),
    quantite: a.stock ? Number(a.stock.quantite) : 0,
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
 * Inventaire d'un mois : l'instantané figé à la clôture s'il existe, sinon l'état actuel
 * (marqué non figé, pour un mois pas encore clôturé ou clôturé avant cette fonctionnalité).
 */
export async function inventaireDuMois(annee: number, mois: number): Promise<Inventaire> {
  const cloture = await prisma.clotureStock.findUnique({ where: { annee_mois: { annee, mois } } });
  const snap = cloture?.snapshot as { valeurTotaleUSD?: number; lignes?: LigneInventaire[] } | null | undefined;
  if (snap?.lignes) {
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
