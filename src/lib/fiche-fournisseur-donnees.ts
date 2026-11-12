import { prisma } from "@/lib/prisma";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { construireFiche, type FicheFournisseurExport } from "@/lib/fiche-fournisseur-export";

/** Lit en base les fournisseurs demandés (4 requêtes, quel que soit leur nombre) et compose leurs fiches, par ordre alphabétique. */
export async function chargerFichesFournisseurs(ids: string[]): Promise<FicheFournisseurExport[]> {
  const [fournisseurs, factures, bons, liens, taux] = await Promise.all([
    prisma.fournisseur.findMany({ where: { id: { in: ids } }, orderBy: { nom: "asc" } }),
    prisma.factureFournisseur.findMany({
      where: { fournisseurId: { in: ids } },
      select: {
        fournisseurId: true, numero: true, date: true, dateEcheance: true, statut: true, annee: true, mois: true, devise: true,
        montantUSD: true, montantRegleUSD: true, resteAPayerUSD: true, montantCDF: true, montantRegleCDF: true, resteAPayerCDF: true,
      },
    }),
    prisma.bonDeCommande.findMany({
      where: { fournisseurId: { in: ids } },
      select: { id: true, fournisseurId: true, numero: true, date: true, statut: true, devise: true, totalUSD: true, totalCDF: true, _count: { select: { lignes: true } } },
    }),
    prisma.articleFournisseur.findMany({
      where: { fournisseurId: { in: ids } },
      select: {
        fournisseurId: true, habituel: true,
        article: { select: { designation: true, marque: true, contenance: true, contenanceUnite: true, devisePrix: true, prixUnitaireUSD: true, prixUnitaireCDF: true, categorie: { select: { nom: true } } } },
      },
    }),
    tauxDuJour(),
  ]);
  const sansPrix = await prisma.ligneBonDeCommande.groupBy({
    by: ["bonDeCommandeId"],
    where: { bonDeCommande: { fournisseurId: { in: ids } }, AND: [{ OR: [{ prixUnitaireUSD: null }, { prixUnitaireUSD: 0 }] }, { OR: [{ prixUnitaireCDF: null }, { prixUnitaireCDF: 0 }] }] },
    _count: { _all: true },
  });
  const nbSansPrix = new Map(sansPrix.map((g) => [g.bonDeCommandeId, g._count._all]));

  return fournisseurs.map((f) =>
    construireFiche(
      f,
      factures.filter((x) => x.fournisseurId === f.id),
      bons.filter((b) => b.fournisseurId === f.id).map((b) => ({ ...b, nbLignes: b._count.lignes, nbSansPrix: nbSansPrix.get(b.id) ?? 0 })),
      liens.filter((l) => l.fournisseurId === f.id).map((l) => ({ ...l.article, categorieNom: l.article.categorie?.nom ?? null, habituel: l.habituel })),
      taux,
    ),
  );
}
