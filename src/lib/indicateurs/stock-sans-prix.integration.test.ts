import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère) — audit du 10/10/2026, stock 10, 15 et 16 :
//  - un article (ou une sortie) SANS prix n'est pas compté 0 : le total est annoncé partiel ;
//  - la consommation sépare livraisons au restaurant et pertes, et ne compte « valorisées » que les valorisées ;
//  - tableau de bord, badge du menu et inventaire de clôture comptent les mêmes articles (ACTIFS) ;
//  - le « Seuil urgent » agit sur l'alerte (tableau de bord ET badge).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { indicateursStock } = await import("./stock");
const { urgentsParDomaine } = await import("./urgents");
const { inventaireActuel, snapshotActuel, inventaireFige } = await import("@/lib/cloture-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const JOUR = new Date("2026-09-29T00:00:00Z");

async function creer(designation: string, o: { usd?: string; quantite: string; min?: string; urgent?: string; actif?: boolean; domaine?: "NOURRITURE" | "BOISSON" }) {
  const a = await prisma.articleStock.create({ data: { designation, domaine: o.domaine ?? "NOURRITURE", unite: "kg", actif: o.actif ?? true, prixUnitaireUSD: o.usd ?? null } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: o.quantite, stockMinimum: o.min ?? "0", seuilUrgent: o.urgent ?? "0" } });
  return a;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  const farine = await creer("Farine", { usd: "2.5", quantite: "10" }); // 25,00 $
  const sansPrix = await creer("Sachet sans prix", { quantite: "4" }); // valeur inconnue
  await creer("Ancien article", { usd: "10", quantite: "5", actif: false, min: "3" }); // archivé : hors total
  await creer("Huile", { usd: "3", quantite: "4", min: "10", urgent: "5" }); // 4 ≤ seuil urgent 5 : URGENT
  await creer("Eau", { usd: "1", quantite: "0", min: "10", actif: false, domaine: "BOISSON" }); // rupture mais archivée : pas comptée
  await creer("Jus", { usd: "1", quantite: "0", min: "10", domaine: "BOISSON" }); // rupture : URGENT
  // Sorties du mois : livraison valorisée (farine 2 × 2,50), perte valorisée (montant saisi), perte SANS prix.
  await prisma.mouvementStock.create({ data: { articleId: farine.id, type: "SORTIE", quantite: 2, date: JOUR, categorieSortie: "LIVRAISON_RESTAURANT" } });
  await prisma.mouvementStock.create({ data: { articleId: farine.id, type: "SORTIE", quantite: 1, date: JOUR, categorieSortie: "PERTE", raisonSortie: "moisi", montantUSD: 1.25 } });
  await prisma.mouvementStock.create({ data: { articleId: sansPrix.id, type: "SORTIE", quantite: 3, date: JOUR, categorieSortie: "PERTE", raisonSortie: "casse" } });
}, 120_000);
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

describe("valeur du stock : annoncée partielle, articles actifs seulement", () => {
  it("l'article sans prix n'est pas compté 0 en silence ; l'archivé n'est pas compté", async () => {
    const ind = await indicateursStock(new Date("2026-09-30T12:00:00Z"));
    expect(ind.valeurStock).toBeCloseTo(25 + 12 + 0 /* huile 4 × 3 */ + 0, 6); // farine 25 + huile 12 + jus 0 (qté 0)
    expect(ind.valeurStockSansPrix).toBe(1); // « Sachet sans prix » (en stock, sans prix)
  }, 60_000);

  it("inventaire de clôture : même filtre (actifs), même annonce, et de quand il date", async () => {
    const inv = await inventaireActuel();
    expect(inv.lignes.map((l) => l.designation)).not.toContain("Ancien article");
    expect(inv.nbSansPrix).toBe(1);
    expect(inv.lignes.find((l) => l.designation === "Sachet sans prix")).toMatchObject({ sansPrix: true });
    expect(inv.valeurTotaleUSD).toBe(37);
    const snap = await snapshotActuel();
    expect(snap.nbSansPrix).toBe(1);
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8, snapshot: snap } });
    const fige = await inventaireFige(2026, 8);
    expect(fige?.nbSansPrix).toBe(1);
    expect(fige?.figeLe).toBeInstanceOf(Date); // l'instantané dit de quand il date
  }, 60_000);
});

describe("consommation du mois : par motif, valorisées seulement", () => {
  it("livraisons et pertes séparées ; la sortie sans prix est annoncée, pas comptée 0 ni dans « valorisées »", async () => {
    const { consoMois } = await indicateursStock(new Date("2026-09-30T12:00:00Z"));
    expect(consoMois.livraisons).toEqual({ montant: 5, nb: 1, nbSansPrix: 0 });
    expect(consoMois.pertes).toEqual({ montant: 1.25, nb: 1, nbSansPrix: 1 });
    expect(consoMois.montant).toBeCloseTo(6.25, 6);
    expect(consoMois.nb).toBe(2); // 3 sorties, dont 2 valorisées
    expect(consoMois.nbSansPrix).toBe(1);
  }, 60_000);
});

describe("alertes : seuil urgent et même filtre partout", () => {
  it("le seuil urgent déclenche l'alerte Urgent du tableau de bord", async () => {
    const ind = await indicateursStock(new Date("2026-09-30T12:00:00Z"));
    expect(ind.alertes.filter((a) => a.niveau === "URGENT").map((a) => a.designation).sort()).toEqual(["Huile", "Jus"]);
    expect(ind.nbUrgent).toBe(2);
  }, 60_000);

  it("le badge du menu compte les mêmes articles urgents (actifs) que le tableau de bord", async () => {
    const ind = await indicateursStock(new Date("2026-09-30T12:00:00Z"));
    const badge = await urgentsParDomaine();
    expect(badge.NOURRITURE + badge.BOISSON + badge.AUTRE).toBe(ind.nbUrgent);
    expect(badge).toEqual({ NOURRITURE: 1, BOISSON: 1, AUTRE: 0 });
  }, 60_000);
});
