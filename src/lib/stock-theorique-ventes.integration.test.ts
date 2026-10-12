import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — stock THÉORIQUE du restaurant avec les ventes
// × fiches (décision Direction 2026-10-12) : du chargement groupé jusqu'à la disponibilité des plats et au
// contrôle des écarts. Cas chiffré : 2 kg comptés lundi, 3 kg livrés, 10 plats à 80 g vendus → 4,2 kg.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { chargerEntreesStockResto } = await import("@/lib/stock-restaurant-charger");
const { stockRestaurantTheorique, consommationReelle } = await import("@/lib/stock-restaurant");
const { chargerStocksDesFiches } = await import("@/app/(stock)/stock/fiches/_data/charger-fiche");
const { chargerEcartsVentes } = await import("@/app/(stock)/stock/journalier/ecarts-data");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let farine: string, resto: string, plat: string, sauce: string, platSauce: string, gin: string, restoGin: string, cocktail: string;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });

  // Cuisine : farine (kg) ; plat « Brioche » = 80 g de farine ; sauce (1 000 g = 200 g de farine) ; plat à la sauce (100 g de sauce).
  farine = (await prisma.articleStock.create({ data: { designation: "Farine T55", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: 2 } })).id;
  resto = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Farine", unite: "kg", liens: { create: { articleStockId: farine } } } })).id;
  await prisma.comptageResto.create({ data: { articleRestoId: resto, date: d("2026-10-05"), quantite: "2" } });
  await prisma.mouvementStock.create({ data: { articleId: farine, type: "SORTIE", quantite: "3", date: d("2026-10-06"), categorieSortie: "LIVRAISON_RESTAURANT" } });
  plat = (await prisma.ficheTechnique.create({ data: { nom: "Brioche", ingredients: { create: { articleId: farine, unite: "g", quantite: "80", ordre: 0 } } } })).id;
  sauce = (await prisma.ficheTechnique.create({ data: { nom: "Sauce", estSousRecette: true, rendementQuantite: "1000", rendementUnite: "g", ingredients: { create: { articleId: farine, unite: "g", quantite: "200", ordre: 0 } } } })).id;
  platSauce = (await prisma.ficheTechnique.create({ data: { nom: "Plat à la sauce", ingredients: { create: { sousFicheId: sauce, unite: "g", quantite: "100", ordre: 0 } } } })).id;
  await prisma.venteJournaliere.createMany({ data: [
    { date: d("2026-10-05"), ficheId: plat, quantite: 50 }, // jour du comptage : déjà dans le comptage de fin de journée
    { date: d("2026-10-07"), ficheId: plat, quantite: 10 },
  ] });

  // Bar : gin en bouteilles de 70 cl, 35 $ ; cocktails à 4 cl ; comptages 10 (dim. 4) → 8 (dim. 11), 2 livrées.
  gin = (await prisma.articleStock.create({ data: { designation: "Gin", domaine: "BOISSON", unite: "bouteille", contenance: "70", contenanceUnite: "cl", prixUnitaireUSD: 35 } })).id;
  restoGin = (await prisma.articleResto.create({ data: { espace: "BAR", designation: "Gin", unite: "bouteille", liens: { create: { articleStockId: gin } } } })).id;
  await prisma.comptageResto.createMany({ data: [{ articleRestoId: restoGin, date: d("2026-10-04"), quantite: "10" }, { articleRestoId: restoGin, date: d("2026-10-11"), quantite: "8" }] });
  await prisma.mouvementStock.create({ data: { articleId: gin, type: "SORTIE", quantite: "2", date: d("2026-10-07"), categorieSortie: "LIVRAISON_RESTAURANT" } });
  cocktail = (await prisma.ficheTechnique.create({ data: { nom: "Gin tonic", type: "BAR", ingredients: { create: { articleId: gin, unite: "cl", quantite: "4", ordre: 0 } } } })).id;
  await prisma.venteJournaliere.create({ data: { date: d("2026-10-08"), ficheId: cocktail, quantite: 60 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("stock théorique chargé depuis la base", () => {
  it("2 kg comptés lundi + 3 kg livrés − 10 plats à 80 g = 4,2 kg ; les 50 ventes du jour du comptage ne comptent pas", async () => {
    const e = await chargerEntreesStockResto({ depuis: "2026-10-08", jusquA: "2026-10-08", avecVentes: true });
    const s = stockRestaurantTheorique(e, "2026-10-08").parArticle.get(resto)!;
    expect(Number(s.stock)).toBeCloseTo(4.2, 9);
    expect(Number(s.vendu)).toBeCloseTo(0.8, 9);
    expect(s.ventesAVerifier).toEqual([]);
  });

  it("sans l'option, les ventes ne sont pas chargées (consommation réelle inchangée)", async () => {
    const e = await chargerEntreesStockResto({ depuis: "2026-10-08", jusquA: "2026-10-08" });
    expect(stockRestaurantTheorique(e, "2026-10-08").parArticle.get(resto)!.stock).toBe("5");
    expect(consommationReelle(e, resto, "2026-10-08")).toMatchObject({ etat: "INCONNUE" });
  });

  it("sous-recette : 100 g de sauce par plat (1 000 g = 200 g de farine) → 20 g de farine par plat", async () => {
    await prisma.venteJournaliere.create({ data: { date: d("2026-10-09"), ficheId: platSauce, quantite: 10 } });
    const e = await chargerEntreesStockResto({ depuis: "2026-10-09", jusquA: "2026-10-09", avecVentes: true });
    expect(Number(stockRestaurantTheorique(e, "2026-10-09").parArticle.get(resto)!.vendu)).toBeCloseTo(0.8 + 0.2, 9);
  });

  it("disponibilité des plats : la part du restaurant est nette des ventes ; fiche incomplète vendue → « À vérifier »", async () => {
    const stocks = await chargerStocksDesFiches("2026-10-09");
    const resto0 = stocks[farine]!.restaurant;
    expect(resto0).toMatchObject({ etat: "OK" });
    if (resto0 && resto0.etat === "OK") expect(Number(resto0.quantite)).toBeCloseTo(5 - 1.0, 9);
    // Fiche incomplète (quantité non renseignée) vendue après le comptage.
    const incomplete = (await prisma.ficheTechnique.create({ data: { nom: "Fiche vide de quantité", ingredients: { create: { articleId: farine, unite: "g", quantite: "0", ordre: 0 } } } })).id;
    await prisma.venteJournaliere.create({ data: { date: d("2026-10-09"), ficheId: incomplete, quantite: 3 } });
    const apres = await chargerStocksDesFiches("2026-10-09");
    expect(apres[farine]!.restaurant).toMatchObject({ etat: "VENTES_A_VERIFIER", articleResto: "Farine" });
    await prisma.venteJournaliere.deleteMany({ where: { ficheId: incomplete } });
  });
});

describe("contrôle des écarts ventes / consommation (semaine du 5 au 11 octobre)", () => {
  it("bar : réel 4 bouteilles (10 + 2 − 8) face à 60 cocktails × 4 cl = 3,43 bouteilles → écart 40 cl, +20 $", async () => {
    const { ecarts, espaces } = await chargerEcartsVentes(d("2026-10-05"), undefined);
    expect(espaces).toEqual(["CUISINE", "BAR"]);
    const g = ecarts.BAR.find((l) => l.articleRestoId === restoGin)!;
    expect(g.periode).toMatchObject({ etat: "CONNUE", de: "2026-10-04", a: "2026-10-11", reelle: "4" });
    expect(Number(g.valeur!.montant)).toBeCloseTo(20, 6);
    expect(g.valeur!.devise).toBe("USD");
    // Cuisine : un seul comptage (le lundi) dans la période, aucun avant → rien à comparer, jamais 0.
    expect(ecarts.CUISINE.find((l) => l.articleRestoId === resto)!.periode).toMatchObject({ etat: "INCONNUE" });
  });

  it("le filtre Bar / Cuisine sépare les espaces", async () => {
    expect((await chargerEcartsVentes(d("2026-10-05"), "BOISSON")).ecarts.CUISINE).toEqual([]);
    expect((await chargerEcartsVentes(d("2026-10-05"), "NOURRITURE")).ecarts.BAR).toEqual([]);
  });
});
