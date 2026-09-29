import "server-only";

import { prisma } from "@/lib/prisma";
import { derniereClotureStock, estDansPeriodeFigee } from "@/lib/cloture-stock";
import { cleCase, cleFiche, cleResto, lignesDuRapport, type EspaceVente, type LigneVente } from "@/lib/ventes-journalieres";

// Ventes de la semaine (lecture seule, requêtes groupées), partagées par la grille de saisie
// (Conso. journalière → Ventes) et par la fiche « Rapport journalier cuisine et bar ».

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type VentesSemaine = {
  /** Les 7 jours (lundi → dimanche), AAAA-MM-JJ. */
  jours: string[];
  /** Lignes par espace, dans l'ordre d'affichage. */
  lignes: Record<EspaceVente, LigneVente[]>;
  /** `cleCase(ligne, jour)` → nombre vendu SAISI (0 compris). Absent = pas de saisie. */
  ventes: Map<string, number>;
  /** Jours en période de stock clôturée : lecture seule. */
  joursFiges: Set<string>;
};

/**
 * Ventes de la semaine du `lundi` pour les espaces demandés. Lignes : fiches techniques vendues
 * (PLAT → Cuisine, BAR → Bar ; jamais une sous-recette) et articles du bar, ACTIFS — plus ceux,
 * désactivés depuis, qui portent une vente cette semaine : une quantité saisie n'est jamais cachée.
 */
export async function chargerVentesSemaine(lundi: Date, espaces: EspaceVente[]): Promise<VentesSemaine> {
  const jours = Array.from({ length: 7 }, (_, i) => { const d = new Date(lundi); d.setUTCDate(d.getUTCDate() + i); return iso(d); });
  const fin = new Date(lundi); fin.setUTCDate(fin.getUTCDate() + 7);
  const types = espaces.map((e) => (e === "CUISINE" ? "PLAT" as const : "BAR" as const));

  const [ventes, borne] = await Promise.all([
    prisma.venteJournaliere.findMany({ where: { date: { gte: lundi, lt: fin } }, select: { date: true, ficheId: true, articleRestoId: true, quantite: true } }),
    derniereClotureStock(),
  ]);
  const fichesVendues = [...new Set(ventes.flatMap((v) => (v.ficheId ? [v.ficheId] : [])))];
  const boissonsVendues = [...new Set(ventes.flatMap((v) => (v.articleRestoId ? [v.articleRestoId] : [])))];

  const [fiches, boissons] = await Promise.all([
    prisma.ficheTechnique.findMany({
      where: { estSousRecette: false, type: { in: types }, OR: [{ actif: true }, { id: { in: fichesVendues } }] },
      select: { id: true, nom: true, categorie: true, type: true, actif: true },
    }),
    espaces.includes("BAR")
      ? prisma.articleResto.findMany({
          where: { espace: "BAR", OR: [{ actif: true }, { id: { in: boissonsVendues } }] },
          select: { id: true, designation: true, unite: true, categorie: true, ordre: true, actif: true },
        })
      : Promise.resolve([]),
  ]);

  const carte = new Map<string, number>();
  for (const v of ventes) {
    const ligne = v.ficheId ? cleFiche(v.ficheId) : v.articleRestoId ? cleResto(v.articleRestoId) : null;
    if (ligne) carte.set(cleCase(ligne, iso(v.date)), v.quantite);
  }

  const lignes = { CUISINE: [], BAR: [] } as Record<EspaceVente, LigneVente[]>;
  for (const e of espaces) lignes[e] = lignesDuRapport(e, fiches, e === "BAR" ? boissons : []);

  return {
    jours,
    lignes,
    ventes: carte,
    joursFiges: new Set(jours.filter((j) => estDansPeriodeFigee(new Date(`${j}T00:00:00Z`), borne))),
  };
}
