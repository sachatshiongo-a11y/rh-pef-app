import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { ecartMinimalEntreRangees, pagesDuPdf, policesDeRepli, textesPoses } from "@/lib/test/pdf-lecture";

/**
 * Fiches de l'onglet Consommation (Stock → Conso. journalière), bout à bout : la route lit une
 * VRAIE base (Postgres éphémère), rend le PDF et l'Excel, et on relit ce qui en sort.
 * `SORTIE_FICHES=<dossier>` garde les fichiers produits (pour les regarder).
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => ({ id: "u", role: "STOCK", nom: "Stock" }), requireModule: () => {} }));

const { GET: fiche } = await import("./fiche/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;

  // Catalogue : cuisine (nourriture + autre), bar.
  const cat = async (nom: string, domaine: "NOURRITURE" | "BOISSON" | "AUTRE") => prisma.categorieStock.create({ data: { nom, domaine } });
  const viande = await cat("Viande", "NOURRITURE");
  const cremerie = await cat("Crèmerie", "NOURRITURE");
  const entretien = await cat("Produits d'entretien", "AUTRE");
  const bieres = await cat("Bière locale", "BOISSON");
  const art = (designation: string, domaine: "NOURRITURE" | "BOISSON" | "AUTRE", categorieId: string | null, unite: string | null, actif = true) =>
    prisma.articleStock.create({ data: { designation, domaine, categorieId, unite, actif } });
  const boeuf = await art("Filet pur Boeuf", "NOURRITURE", viande.id, "Kg");
  await art("Côtes de porc", "NOURRITURE", viande.id, "Pièce");
  const beurre = await art("Beurre", "NOURRITURE", cremerie.id, null);
  await art("Vim", "AUTRE", entretien.id, "Boîte");
  const castel = await art("Castel", "BOISSON", bieres.id, "Bouteille");
  const ancien = await art("Ancien article", "NOURRITURE", viande.id, "Kg", false);
  // 30 articles de plus : la fiche cuisine déborde d'une page (rubrique répétée, rangées lisibles).
  for (let i = 1; i <= 40; i++) await art(`Épice n° ${String(i).padStart(2, "0")}`, "NOURRITURE", null, "g");

  // Mardi 22/09/2026 : commandes, livraisons, perte, sortie sans motif, légumes.
  await prisma.commandeResto.createMany({ data: [
    { articleId: boeuf.id, date: le("2026-09-22"), quantite: 2.5 },
    { articleId: castel.id, date: le("2026-09-22"), quantite: 24 },
    { articleId: boeuf.id, date: le("2026-09-23"), quantite: 99 }, // autre jour
  ] });
  const sortie = (articleId: string, quantite: number, categorieSortie: string | null, date = "2026-09-22") =>
    prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite, date: le(date), categorieSortie } });
  await sortie(boeuf.id, 2, "LIVRAISON_RESTAURANT");
  await sortie(beurre.id, 1234.5, "LIVRAISON_RESTAURANT");
  await sortie(castel.id, 24, "LIVRAISON_RESTAURANT");
  await sortie(castel.id, 1, "PERTE"); // reste au dépôt : pas une livraison
  await sortie(boeuf.id, 7, null); // sans motif : annoncée, jamais comptée comme livrée
  await sortie(ancien.id, 3, "LIVRAISON_RESTAURANT"); // article désactivé depuis : reste visible
  await prisma.commandeLegumeResto.create({ data: { legume: "Ail", date: le("2026-09-22"), quantite: 3 } });
  await prisma.achatLegume.create({ data: { legume: "ail", unite: "Kg", date: le("2026-09-22"), quantite: 2.75 } });

  // Restaurant : Bar (comptages → consommation réelle), Cuisine.
  const coca = await prisma.articleResto.create({ data: { espace: "BAR", categorie: "Limonade et autre", designation: "Coca", unite: "Bouteille", ordre: 1 } });
  await prisma.articleResto.create({ data: { espace: "BAR", categorie: "Limonade et autre", designation: "Fanta", unite: "Bouteille", ordre: 2 } });
  await prisma.articleResto.create({ data: { espace: "CUISINE", categorie: "Viande", designation: "Filet de boeuf", unite: "Kg", ordre: 1 } });
  const compter = (id: string, date: string, q: number) => prisma.comptageResto.create({ data: { articleRestoId: id, date: le(date), quantite: q } });
  await compter(coca.id, "2026-09-21", 40);
  await compter(coca.id, "2026-09-22", 28); // 40 − 28 = 12 consommées le mardi
}, 120_000);

afterAll(async () => { await fermer?.(); });

/** Rangées d'une feuille, indexées par numéro de ligne Excel (1re cellule en [0]). */
const rangeesDe = (ws: ExcelJS.Worksheet) => Array.from(ws.getSheetValues(), (r) => (Array.isArray(r) ? r.slice(1) : []));

async function lire(url: string) {
  const r = await fiche(new Request(`http://pef.test/stock/journalier/fiche?${url}`));
  expect(r.status).toBe(200);
  const buf = Buffer.from(await r.arrayBuffer());
  const nom = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "";
  if (process.env.SORTIE_FICHES) fs.writeFileSync(path.join(process.env.SORTIE_FICHES, nom), buf);
  return { buf, nom, type: r.headers.get("Content-Type") };
}

describe("fiche « Commande journalière »", () => {
  it("PDF : fiche cuisine puis fiche bar, commande et livraison du jour, rangées lisibles", async () => {
    const { buf, nom, type } = await lire("type=commande&date=2026-09-22&format=pdf");
    expect(type).toBe("application/pdf");
    expect(nom).toBe("Commande_journaliere_2026-09-22.pdf");
    const pages = await pagesDuPdf(buf);
    const lignes = pages.flatMap((p) => p.lignes);
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat).toContain("mardi 22 septembre 2026 (semaine 39)");
    expect(plat).toContain("Commande cuisine — semaine 39");
    expect(plat).toContain("Commande bar — semaine 39");
    expect(lignes).toContain("Filet pur Boeuf Kg 2,5 2");
    expect(lignes).toContain("Côtes de porc Pièce");
    expect(lignes).toContain("Beurre — 1 234,5"); // unité absente du catalogue : « — »
    expect(lignes).toContain("Ancien article Kg 3");
    expect(lignes).toContain("Vim Boîte"); // « autre » : sur la fiche cuisine, comme dans le classeur
    expect(lignes).toContain("Ail Kg 3 2,75"); // légume : commande saisie, livraison = achat du jour
    expect(lignes).toContain("Castel 24 24"); // bar : pas de colonne Unité ; la perte n'est pas livrée
    expect(plat).toContain("1 sortie(s) sans motif ce jour-là ne sont pas comptées comme livrées");
    // La fiche bar commence sur sa propre page.
    const pageBar = pages.findIndex((p) => p.plat.includes("Commande bar"));
    expect(pageBar).toBeGreaterThan(0);
    expect(pages[pageBar]!.plat).not.toContain("Filet pur Boeuf");
    expect(ecartMinimalEntreRangees(await textesPoses(buf), /^Épice n° \d+$/)).toBeGreaterThanOrEqual(8);
    expect(policesDeRepli(buf)).toEqual([]);
  }, 120_000);

  it("Excel : une feuille par fiche, nombres calculables, volet figé sur la ligne des colonnes", async () => {
    const { buf, nom } = await lire("type=commande&date=2026-09-22&format=excel");
    expect(nom).toBe("Commande_journaliere_2026-09-22.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Fiche commande cuisine", "Fiche commande Bar"]);
    const cuisine = wb.getWorksheet("Fiche commande cuisine")!;
    const rangees = rangeesDe(cuisine);
    const entete = rangees.findIndex((r) => r[0] === "Désignation/Date");
    expect(rangees[entete]).toEqual(["Désignation/Date", "Unité", "Commande", "Livraison"]);
    expect(cuisine.views[0]).toMatchObject({ state: "frozen", ySplit: entete });
    expect(rangees.find((r) => r[0] === "Filet pur Boeuf")).toEqual(["Filet pur Boeuf", "Kg", 2.5, 2]);
    expect(rangees.find((r) => r[0] === "Beurre")).toEqual(["Beurre", "—", "", 1234.5]);
    const bar = rangeesDe(wb.getWorksheet("Fiche commande Bar")!);
    expect(bar.find((r) => r[0] === "Castel")).toEqual(["Castel", 24, 24]);
  }, 120_000);

  it("filtre Bar : la seule fiche bar", async () => {
    const { buf, nom } = await lire("type=commande&date=2026-09-22&domaine=BOISSON&format=pdf");
    expect(nom).toBe("Commande_journaliere_bar_2026-09-22.pdf");
    const plat = (await pagesDuPdf(buf)).map((p) => p.plat).join(" ");
    expect(plat).toContain("Commande bar");
    expect(plat).not.toContain("Commande cuisine");
  }, 120_000);
});

describe("fiche « Rapport journalier cuisine et bar »", () => {
  it("PDF : consommation réelle par jour, « — » les jours sans comptage, lundi → samedi", async () => {
    const { buf, nom } = await lire("type=rapport&semaine=2026-09-23&format=pdf");
    expect(nom).toBe("Rapport_journalier_2026-09-21.pdf");
    const pages = await pagesDuPdf(buf);
    const lignes = pages.flatMap((p) => p.lignes);
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat).toContain("semaine 39, du 21/09/2026 au 26/09/2026");
    expect(plat).toContain("Rapport journalier cuisine — semaine 39");
    expect(plat).toContain("Rapport journalier bar — semaine 39");
    expect(plat).not.toContain("DIM 27/09");
    expect(lignes).toContain("Coca (Bouteille) — 12 — — — —");
    expect(lignes).toContain("Fanta (Bouteille) — — — — — —");
    expect(lignes).toContain("Filet de boeuf (Kg) — — — — — —");
    expect(policesDeRepli(buf)).toEqual([]);
  }, 120_000);

  it("Excel : feuilles Cuisine et Bar, la consommation connue est un nombre, l'inconnue « — »", async () => {
    const { buf } = await lire("type=rapport&semaine=2026-09-21&format=excel");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Cuisine", "Bar"]);
    const bar = rangeesDe(wb.getWorksheet("Bar")!);
    expect(bar.find((r) => r[0] === "Désignation/Date")).toEqual(["Désignation/Date", "Lun 21/09", "Mar 22/09", "Mer 23/09", "Jeu 24/09", "Ven 25/09", "Sam 26/09"]);
    expect(bar.find((r) => r[0] === "Coca (Bouteille)")).toEqual(["Coca (Bouteille)", "—", 12, "—", "—", "—", "—"]);
  }, 120_000);
});

describe("paramètres", () => {
  it("date ou semaine illisible, fiche inconnue : refusées (jamais un autre jour à la place)", async () => {
    for (const q of ["type=commande&date=2026-02-31", "type=commande&date=hier", "type=rapport&semaine=demain", "type=autre"]) {
      expect((await fiche(new Request(`http://pef.test/stock/journalier/fiche?${q}`))).status, q).toBe(400);
    }
  });
});
