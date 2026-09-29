import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Stock qui fait foi pour la disponibilité : dépôt + STOCK THÉORIQUE des articles du restaurant
// rattachés (dernier comptage + livraisons reçues depuis). Base Postgres éphémère, jamais la production.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { chargerStocksDesFiches } = await import("./charger-fiche");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
}, 120_000);

afterAll(async () => { await fermer?.(); });

const article = (designation: string, unite: string) =>
  prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite } });
const resto = (designation: string, unite: string, articleStockId: string | null, actif = true) =>
  prisma.articleResto.create({ data: { espace: "CUISINE", designation, unite, articleStockId, actif } });
const compter = (articleRestoId: string, date: string, quantite: string) =>
  prisma.comptageResto.create({ data: { articleRestoId, date: new Date(date), quantite } });

describe("chargerStocksDesFiches", () => {
  it("dépôt seul, dernier comptage seul, plusieurs articles rattachés, non rattaché ignoré", async () => {
    const farine = await article("Farine", "kg");
    const creme = await article("Crème", "l");
    const sel = await article("Sel", "kg");
    await prisma.stock.create({ data: { articleId: farine.id, quantite: "4" } });
    await prisma.stock.create({ data: { articleId: sel.id, quantite: "1.5" } });

    // Farine : deux articles du restaurant rattachés ; seul le DERNIER comptage de chacun compte.
    const f1 = await resto("Farine cuisine", "g", farine.id);
    await compter(f1.id, "2026-09-20", "9000"); // ancien : ignoré
    await compter(f1.id, "2026-09-22", "1500");
    const f2 = await resto("Farine pâtisserie", "kg", farine.id);
    await compter(f2.id, "2026-09-21", "2");
    // Crème : rattachée, sans ligne Stock.
    const c1 = await resto("Crème", "cl", creme.id);
    await compter(c1.id, "2026-09-22", "50");
    // Non rattaché : ignoré. Rattaché mais DÉSACTIVÉ avec 100 kg comptés : jamais ignoré en silence
    // (règle du 2026-09-29) — l'article du catalogue passe « À vérifier », pas « dépôt seul ».
    const libre = await resto("Farine", "kg", null);
    await compter(libre.id, "2026-09-23", "100");
    const inactif = await resto("Sel (ancien)", "kg", sel.id, false);
    await compter(inactif.id, "2026-09-23", "100");

    // Mouvements au dépôt (tous types, ajustement d'inventaire compris) : seul le plus RÉCENT compte.
    const bouger = (articleId: string, type: "ENTREE" | "SORTIE" | "AJUSTEMENT", date: string) =>
      prisma.mouvementStock.create({ data: { articleId, type, quantite: "1", date: new Date(date) } });
    await bouger(farine.id, "ENTREE", "2026-07-10");
    await bouger(farine.id, "AJUSTEMENT", "2026-09-20");
    await bouger(farine.id, "SORTIE", "2026-08-01");
    // Crème et Sel : jamais mouvementés.

    const groupBy = vi.spyOn(prisma.mouvementStock, "groupBy");
    const findMany = vi.spyOn(prisma.mouvementStock, "findMany");
    const stocks = await chargerStocksDesFiches("2026-09-23");

    expect(stocks[farine.id]).toEqual({ depot: "4", restaurant: { etat: "OK", quantite: "3.5", dateComptage: "2026-09-21", recu: null }, dernierMouvement: "2026-09-20" });
    expect(stocks[creme.id]).toEqual({ depot: null, restaurant: { etat: "OK", quantite: "0.5", dateComptage: "2026-09-22", recu: null }, dernierMouvement: null });
    expect(stocks[sel.id]).toEqual({ depot: "1.5", restaurant: { etat: "DESACTIVE_AVEC_STOCK", articleResto: "Sel (ancien)", dateComptage: "2026-09-23" }, dernierMouvement: null });
    // UNE requête groupée pour tous les articles (dernier mouvement), UNE pour les livraisons au
    // restaurant — jamais une requête par article.
    // (+ UNE pour les livraisons reçues depuis le comptage des articles DÉSACTIVÉS avec du stock.)
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(2);
    groupBy.mockRestore(); findMany.mockRestore();
  }, 60_000);

  it("la part du restaurant ajoute les livraisons « Livraison restaurant » reçues depuis le comptage (pas les pertes)", async () => {
    const tomate = await article("Tomate", "kg");
    await prisma.stock.create({ data: { articleId: tomate.id, quantite: "5" } });
    const t = await resto("Tomate", "g", tomate.id);
    await compter(t.id, "2026-09-20", "1000");
    const sortie = (date: string, quantite: string, categorieSortie: string | null) =>
      prisma.mouvementStock.create({ data: { articleId: tomate.id, type: "SORTIE", quantite, date: new Date(date), categorieSortie } });
    await sortie("2026-09-20", "9", "LIVRAISON_RESTAURANT"); // le jour du comptage : le comptage fait foi
    await sortie("2026-09-21", "2", "LIVRAISON_RESTAURANT");
    await sortie("2026-09-21", "1", "PERTE");
    await sortie("2026-09-22", "1", null);
    await sortie("2026-09-24", "4", "LIVRAISON_RESTAURANT"); // après le jour de référence

    const stocks = await chargerStocksDesFiches("2026-09-22");
    expect(stocks[tomate.id]).toEqual({
      depot: "5",
      restaurant: { etat: "OK", quantite: "3", dateComptage: "2026-09-20", recu: "2" },
      dernierMouvement: "2026-09-24",
    });
    // Rien n'est écrit : ni comptage, ni stock du dépôt.
    expect(await prisma.comptageResto.count({ where: { articleRestoId: t.id } })).toBe(1);
    expect((await prisma.stock.findUniqueOrThrow({ where: { articleId: tomate.id } })).quantite.toString()).toBe("5");
  }, 60_000);
});
