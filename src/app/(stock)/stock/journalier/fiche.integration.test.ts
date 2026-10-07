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
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, role: "STOCK" }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => ({ id: "u", role: H.role, nom: "Stock" }), requireModule: () => {} }));

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
  // Noms COURTS (demande de Sacha) : saisi au catalogue, ou celui de l'article du restaurant rattaché.
  const viandeClasseur = await cat("Viande -Volaille-Poisson-Crustacé", "NOURRITURE");
  const pates = await cat("Pâtes", "NOURRITURE");
  const agneau = await prisma.articleStock.create({ data: { designation: "Lamb Rack NZ Frozen Frenched 1kg", nomCourt: "Carré d'agneau", domaine: "NOURRITURE", categorieId: viandeClasseur.id, unite: "Kg" } });
  const spaghetti = await art("Spaghetti Lm Chef 12 X 1KG", "NOURRITURE", pates.id, "Kg");
  await prisma.articleResto.create({ data: { espace: "CUISINE", categorie: "Pâtes", designation: "Spaghetti", ordre: 50, articleStockId: spaghetti.id } });
  const heineken = await art("Heineken Bottle 33cl x24 (local)", "BOISSON", bieres.id, "Bouteille");
  await prisma.articleResto.create({ data: { espace: "BAR", categorie: "Bière locale", designation: "Heineken local", ordre: 20, articleStockId: heineken.id } });
  // Deux articles du restaurant rattachés au même article : aucun n'est choisi au hasard.
  const creme = await art("Elle & Vire Crème de cuisson 1L", "NOURRITURE", cremerie.id, "L");
  await prisma.articleResto.create({ data: { espace: "CUISINE", categorie: "Crèmerie", designation: "Crème A", ordre: 60, articleStockId: creme.id } });
  await prisma.articleResto.create({ data: { espace: "CUISINE", categorie: "Crèmerie", designation: "Crème B", ordre: 61, articleStockId: creme.id } });
  await prisma.commandeResto.create({ data: { articleId: agneau.id, date: le("2026-09-22"), quantite: 3 } });
  // 30 articles de plus : la fiche cuisine déborde d'une page (rubrique répétée, rangées lisibles).
  for (let i = 1; i <= 40; i++) await art(`Épice n° ${String(i).padStart(2, "0")}`, "NOURRITURE", null, "g");

  // Fiche commande : les articles COCHÉS « Sur la fiche commande » (tous ici, sauf l'ancien article
  // désactivé, qui n'apparaît que par sa livraison du jour).
  await prisma.articleStock.updateMany({ where: { actif: true }, data: { surFicheCommande: true } });

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

  // Ventes (onglet Ventes) : plats (fiches PLAT), boissons (articles du bar, fiche Bar).
  const fiche = (nom: string, categorie: string | null, type: "PLAT" | "BAR" = "PLAT", estSousRecette = false) =>
    prisma.ficheTechnique.create({ data: { nom, categorie, type, estSousRecette } });
  const carbo = await fiche("Carbonara", "Pâtes classiques");
  await fiche("Arrabbiata", "Pâtes classiques");
  const duo = await fiche("Duo de capitaine et de saumon fumé", "Entrées froides");
  await fiche("Sauce bolognaise", "Pâtes classiques", "PLAT", true); // sous-recette : jamais au rapport
  const mojito = await fiche("Mojito", "Cocktail", "BAR");
  const cocaVendu = await fiche("Coca", "Limonade et autre", "BAR");
  // 45 desserts de plus : la feuille Cuisine déborde d'une page (en-tête répété, rangées lisibles).
  for (let i = 1; i <= 45; i++) await fiche(`Dessert n° ${String(i).padStart(2, "0")}`, "Desserts");
  const vendre = (d: { ficheId: string }, date: string, quantite: number) =>
    prisma.venteJournaliere.create({ data: { ...d, date: le(date), quantite } });
  await vendre({ ficheId: carbo.id }, "2026-09-21", 12);
  await vendre({ ficheId: carbo.id }, "2026-09-22", 0); // saisi : rien vendu
  await vendre({ ficheId: duo.id }, "2026-09-26", 3);
  await vendre({ ficheId: cocaVendu.id }, "2026-09-23", 24);
  await vendre({ ficheId: mojito.id }, "2026-09-26", 6);
  await vendre({ ficheId: carbo.id }, "2026-09-28", 99); // semaine suivante : pas sur la fiche
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

/** Cases d'une rangée trouvée par sa désignation (colonne `col`, 0 = A), à partir de la désignation. */
const ligneDe = (ws: ExcelJS.Worksheet, designation: string, largeur: number, col = 0) => {
  const r = rangeesDe(ws).find((x) => String(x[col] ?? "").trim() === designation);
  // `largeur` cases (désignation + données) : une case vide en fin de rangée n'a pas de valeur pour ExcelJS.
  return r ? Array.from({ length: largeur }, (_, i) => {
    const v = r[col + i];
    return v === undefined || v === null ? "" : typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v;
  }) : undefined;
};
const numeroDe = (ws: ExcelJS.Worksheet, designation: string, col = 0) => rangeesDe(ws).findIndex((x) => String(x[col] ?? "").trim() === designation);

describe("fiche « Commande journalière » : le classeur « PEF Commande Journalière », rempli", () => {
  it("PDF : fiche cuisine puis fiche bar comme le modèle imprimé, commande et livraison du jour, rangées lisibles", async () => {
    const { buf, nom, type } = await lire("type=commande&date=2026-09-22&format=pdf");
    expect(type).toBe("application/pdf");
    expect(nom).toBe("Commande_journaliere_2026-09-22.pdf");
    const pages = await pagesDuPdf(buf);
    const lignes = pages.flatMap((p) => p.lignes);
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat).toMatch(/COMMANDE CUISINE\s+Semaine\s+39/);
    expect(plat).toMatch(/Date :\s+22\/09\/2026/);
    expect(plat).toMatch(/COMMANDE BAR\s+Semaine\s+39/);
    // Lignes du classeur, à leur place, avec les chiffres du jour (rapprochées par leur nom).
    expect(lignes).toContain("Filet pur Boeuf Kg 2,5 2");
    expect(lignes).toContain("Côtes de porc Pièce");
    expect(lignes).toContain("Beurre — 1 234,5"); // unité absente du catalogue : « — »
    expect(lignes).toContain("Vim Boîte"); // « autre » : sur la fiche cuisine, comme dans le classeur
    expect(lignes).toContain("Ail Kg 3 2,75"); // légume : commande saisie, livraison = achat du jour
    expect(lignes).toContain("Castel 24 24"); // bar : pas de colonne Unité ; la perte n'est pas livrée
    // Ligne du classeur sans article : présente, cases vides (son unité est celle du classeur).
    expect(lignes).toContain("Cailles Pièce");
    // Article absent du classeur, d'une rubrique inconnue du classeur : rubrique ajoutée en fin de fiche.
    expect(lignes).toContain("Ancien article Kg 3");
    expect(plat).toContain("1 sortie(s) sans motif ce jour-là ne sont pas comptées comme livrées");
    // La fiche bar commence sur sa propre page ; la fiche cuisine déborde (rubriques ajoutées) avec
    // l'en-tête de colonnes du classeur en haut de chaque page.
    const pageBar = pages.findIndex((p) => p.plat.includes("COMMANDE BAR"));
    expect(pageBar).toBeGreaterThan(0);
    expect(pages[pageBar]!.plat).not.toContain("Filet pur Boeuf");
    for (const p of pages.slice(1, pageBar)) expect(p.lignes[0]).toMatch(/^Désignation\/Date Unité Commande Livraison/);
    expect(ecartMinimalEntreRangees(await textesPoses(buf), /^Épice n° \d+$/)).toBeGreaterThanOrEqual(6);
    expect(policesDeRepli(buf)).toEqual([]);
  }, 120_000);

  it("noms COURTS de cuisine ; lignes absentes du classeur dans leur rubrique, sinon dans une rubrique ajoutée", async () => {
    const { buf } = await lire("type=commande&date=2026-09-22&format=pdf");
    const pages = await pagesDuPdf(buf);
    const lignes = pages.flatMap((p) => p.lignes);
    const plat = pages.map((p) => p.plat).join(" ");
    expect(lignes).toContain("Carré d'agneau Kg 3"); // nom court saisi au catalogue = ligne du classeur
    expect(plat).not.toContain("Lamb Rack");
    expect(lignes).toContain("Spaghetti Kg"); // nom de l'article du restaurant rattaché = ligne du classeur
    expect(plat).not.toContain("Lm Chef");
    expect(lignes).toContain("Heineken local");
    // Rubriques du classeur dans son ordre, puis les rubriques inconnues du classeur (« Crèmerie »,
    // « Viande », « À classer ») ajoutées à la fin, chacune avec « Commande | Livraison ».
    const rang = (t: string) => lignes.findIndex((l) => l === t || l.startsWith(`${t} Commande Livraison`));
    expect(rang("Viande -Volaille-Poisson-Crustacé")).toBeLessThan(rang("Pâtes"));
    expect(rang("Pâtes")).toBeLessThan(rang("Fruits & Légumes frais"));
    expect(rang("Fruits & Légumes frais")).toBeLessThan(rang("Boulangerie-Patisserie"));
    expect(rang("Boulangerie-Patisserie")).toBeLessThan(rang("Crèmerie"));
    expect(rang("Crèmerie")).toBeLessThan(rang("Viande"));
    expect(rang("Viande")).toBeLessThan(rang("À classer"));
    expect(lignes.indexOf("Elle & Vire Crème de cuisson 1L L")).toBeGreaterThan(rang("Crèmerie")); // deux rattachés : la désignation, rien de deviné
    expect(plat).not.toContain("Case vide");
  }, 120_000);

  it("Excel : le classeur du modèle (3 onglets), nombres calculables, date sous « Date : »", async () => {
    const { buf, nom } = await lire("type=commande&date=2026-09-22&format=excel");
    expect(nom).toBe("Commande_journaliere_2026-09-22.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Fiche commande cuisine ", "Fiche commande Bar ", "Fiche commande Salle"]);
    const cuisine = wb.getWorksheet("Fiche commande cuisine ")!;
    expect(cuisine.getCell("A9").value).toBe("Désignation/Date");
    expect(cuisine.getCell("D6").value).toBe("Date : ");
    expect(cuisine.getCell("D7").value).toBe("22/09/2026");
    expect(cuisine.getCell("C8").value).toBe(39);
    expect(cuisine.views[0]).toMatchObject({ state: "frozen", xSplit: 1 }); // volet du modèle
    expect(ligneDe(cuisine, "Filet pur Boeuf", 4)).toEqual(["Filet pur Boeuf", "Kg", 2.5, 2]);
    expect(ligneDe(cuisine, "Beurre", 4)).toEqual(["Beurre", "—", "", 1234.5]);
    expect(numeroDe(cuisine, "Filet pur Boeuf")).toBe(14); // la rangée 14 du classeur
    const bar = wb.getWorksheet("Fiche commande Bar ")!;
    expect(ligneDe(bar, "Castel", 3)).toEqual(["Castel", 24, 24]);
  }, 120_000);

  it("filtre Bar : la seule fiche bar", async () => {
    const { buf, nom } = await lire("type=commande&date=2026-09-22&domaine=BOISSON&format=pdf");
    expect(nom).toBe("Commande_journaliere_bar_2026-09-22.pdf");
    const plat = (await pagesDuPdf(buf)).map((p) => p.plat).join(" ");
    expect(plat).toContain("COMMANDE BAR");
    expect(plat).not.toContain("COMMANDE CUISINE");
    const x = await lire("type=commande&date=2026-09-22&domaine=BOISSON&format=excel");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Fiche commande Bar "]);
  }, 120_000);
});

describe("fiche « Commande journalière » de toute la semaine (onglet Commande)", () => {
  const sheets = async (url: string) => {
    const { buf, nom } = await lire(url);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return { wb, nom };
  };
  const JOURS_SEMAINE = ["Lun 21", "Mar 22", "Mer 23", "Jeu 24", "Ven 25", "Sam 26"];

  it("PDF : lundi → samedi, chaque jour la fiche cuisine puis la fiche bar, chacune commence sa page ; dimanche vide omis", async () => {
    const { buf, nom, type } = await lire("type=commande&tout=1&semaine=2026-09-24&format=pdf");
    expect(type).toBe("application/pdf");
    expect(nom).toBe("Commande_journaliere_semaine_2026-09-21.pdf");
    const pages = await pagesDuPdf(buf);
    // Chaque fiche commence sur une nouvelle page, par le haut du modèle (logo, date, titre).
    const debuts = pages.flatMap((p) => {
      const t = /COMMANDE (CUISINE|BAR)/.exec(p.plat)?.[1];
      const d = /Date :\s+(\d\d)\/09\/2026/.exec(p.plat)?.[1];
      return t ? [`${t} ${d}`] : [];
    });
    expect(debuts).toEqual(["21", "22", "23", "24", "25", "26"].flatMap((j) => [`CUISINE ${j}`, `BAR ${j}`]));
    for (const p of pages) if (!/COMMANDE (CUISINE|BAR)/.test(p.plat)) expect(p.lignes[0]).toMatch(/^Désignation(\/Date Unité)? Commande Livraison/);
    // Mardi : les quantités du jour ; mercredi : la commande du mercredi, pas celle du mardi.
    const fiche = (t: string, d: string) => {
      const i = pages.findIndex((p) => p.plat.includes(`COMMANDE ${t}`) && p.plat.includes(`${d}/09/2026`));
      const fin = pages.findIndex((p, k) => k > i && /COMMANDE (CUISINE|BAR)/.test(p.plat));
      return pages.slice(i, fin < 0 ? undefined : fin).flatMap((p) => p.lignes);
    };
    expect(fiche("CUISINE", "22")).toContain("Filet pur Boeuf Kg 2,5 2");
    expect(fiche("BAR", "22")).toContain("Castel 24 24");
    expect(fiche("CUISINE", "23")).toContain("Filet pur Boeuf Kg 99");
    expect(fiche("BAR", "23")).toContain("Castel");
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat).not.toContain("27/09/2026");
    expect(plat).toContain("Sorties sans motif, non comptées comme livrées : 1 le mardi 22/09.");
    expect(plat).not.toMatch(/[ ⚠→−]/);
    expect(policesDeRepli(buf)).toEqual([]);
  }, 180_000);

  it("Excel : une feuille du modèle par jour et par fiche (« Lun 21 Cuisine »…), nombres calculables, aucun autofiltre", async () => {
    const { wb, nom } = await sheets("type=commande&tout=1&semaine=2026-09-21&format=excel");
    expect(nom).toBe("Commande_journaliere_semaine_2026-09-21.xlsx");
    const noms = wb.worksheets.map((w) => w.name);
    expect(noms).toEqual(JOURS_SEMAINE.flatMap((j) => [`${j} Cuisine`, `${j} Bar`]));
    const mardi = wb.getWorksheet("Mar 22 Cuisine")!;
    expect(mardi.getCell("A8").value).toBe("COMMANDE CUISINE");
    expect(mardi.getCell("D7").value).toBe("22/09/2026");
    expect(ligneDe(mardi, "Filet pur Boeuf", 4)).toEqual(["Filet pur Boeuf", "Kg", 2.5, 2]);
    expect(ligneDe(mardi, "Beurre", 4)).toEqual(["Beurre", "—", "", 1234.5]);
    for (const ws of wb.worksheets) expect(ws.autoFilter).toBeFalsy(); // le classeur n'en a pas
    expect(ligneDe(wb.getWorksheet("Mer 23 Cuisine")!, "Filet pur Boeuf", 4)).toEqual(["Filet pur Boeuf", "Kg", 99, ""]);
    const bar = wb.getWorksheet("Mar 22 Bar")!;
    expect(bar.getCell("A10").value).toBe("Désignation");
    expect(ligneDe(bar, "Castel", 3)).toEqual(["Castel", 24, 24]);
  }, 180_000);

  it("dimanche : ajouté dès qu'il porte une livraison — seulement sur les fiches de l'espace concerné (filtre de l'écran)", async () => {
    const castel = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Castel" } });
    const dim = await prisma.mouvementStock.create({ data: { articleId: castel.id, type: "SORTIE", quantite: 6, date: le("2026-09-27"), categorieSortie: "LIVRAISON_RESTAURANT" } });
    try {
      const { wb } = await sheets("type=commande&tout=1&semaine=2026-09-21&format=excel");
      expect(wb.worksheets.map((w) => w.name).slice(-2)).toEqual(["Dim 27 Cuisine", "Dim 27 Bar"]);
      expect(ligneDe(wb.getWorksheet("Dim 27 Bar")!, "Castel", 3)).toEqual(["Castel", "", 6]);
      const { buf } = await lire("type=commande&tout=1&semaine=2026-09-21&format=pdf");
      expect((await pagesDuPdf(buf)).map((p) => p.plat).join(" ")).toContain("27/09/2026");
      const barSeul = await sheets("type=commande&tout=1&semaine=2026-09-21&domaine=BOISSON&format=excel");
      expect(barSeul.nom).toBe("Commande_journaliere_bar_semaine_2026-09-21.xlsx");
      expect(barSeul.wb.worksheets.map((w) => w.name)).toEqual([...JOURS_SEMAINE, "Dim 27"].map((j) => `${j} Bar`));
      const cuisineSeule = await sheets("type=commande&tout=1&semaine=2026-09-21&domaine=NOURRITURE&format=excel");
      expect(cuisineSeule.wb.worksheets.map((w) => w.name)).toEqual(JOURS_SEMAINE.map((j) => `${j} Cuisine`));
    } finally {
      await prisma.mouvementStock.delete({ where: { id: dim.id } });
    }
  }, 240_000);
});

describe("fiche « Rapport journalier cuisine et bar » : le classeur de la Direction, rempli des ventes", () => {
  it("PDF : nombre vendu par jour, « — » les jours non saisis, 0 saisi = 0, lundi → samedi, en-tête répété", async () => {
    const { buf, nom } = await lire("type=rapport&semaine=2026-09-23&format=pdf");
    expect(nom).toBe("Rapport_journalier_2026-09-21.pdf");
    const pages = await pagesDuPdf(buf);
    const lignes = pages.flatMap((p) => p.lignes);
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat).toContain("Rapport journalier cuisine");
    expect(plat).toContain("Rapport journalier bar");
    expect(plat).toMatch(/Semaine\s+39/);
    expect(plat).toMatch(/21-sept\.\s+22-sept\.\s+23-sept\.\s+24-sept\.\s+25-sept\.\s+26-sept\./);
    expect(plat).not.toContain("27-sept.");
    expect(plat).not.toContain("→");
    // Cuisine : les plats (fiches « Plat vendu ») sur les lignes du classeur ; jamais une sous-recette.
    expect(lignes).toContain("Carbonara 12 0 — — — —");
    expect(lignes).toContain("Arrabbiata — — — — — —");
    // Plat absent du classeur : à la fin de sa rubrique du classeur.
    expect(lignes).toContain("Duo de capitaine et de saumon fumé — — — — — 3");
    expect(lignes.indexOf("Duo de capitaine et de saumon fumé — — — — — 3")).toBe(lignes.findIndex((l) => l.startsWith("Salade de farfalle")) + 1);
    // Ligne du classeur sans fiche : présente, vide.
    expect(lignes).toContain("Bolognaise");
    expect(plat).not.toContain("Sauce bolognaise");
    expect(plat).not.toContain("99");
    // Bar : les UNITÉS DE VENTE (fiches Bar), jamais les articles du stock (bouteilles).
    expect(lignes).toContain("Coca — — 24 — — —");
    expect(lignes).toContain("Mojito — — — — — 6");
    expect(plat).not.toContain("(Bouteille)");
    // Comme le classeur : aucune mention sous la fiche.
    expect(plat).not.toContain("Nombre vendu");
    // Rubriques du classeur, dans son ordre.
    const iEntrees = lignes.indexOf("Entrées Froides"), iPates = lignes.indexOf("Pâtes classiques"), iDesserts = lignes.indexOf("Desserts");
    expect(iEntrees).toBeGreaterThanOrEqual(0);
    expect(iEntrees).toBeLessThan(iPates);
    expect(iPates).toBeLessThan(iDesserts);
    // 45 desserts absents du classeur : la feuille Cuisine se resserre pour tenir sur sa page, comme
    // Excel (« ajuster à 1 page »), en restant lisible ; chaque page porte l'en-tête de colonnes.
    const pagesCuisine = pages.filter((p) => p.plat.includes("Dessert n°"));
    expect(pagesCuisine.length).toBeGreaterThanOrEqual(1);
    for (const p of pagesCuisine) expect(p.plat).toMatch(/Designation\/Date\s+Lun\s+Mar\s+Mer\s+Jeu\s+Ven\s+Sam/);
    const pageBar = pages.findIndex((p) => p.plat.includes("Rapport journalier bar"));
    expect(pages[pageBar]!.plat).not.toContain("Dessert n°");
    expect(ecartMinimalEntreRangees(await textesPoses(buf), /^Dessert n° \d+$/)).toBeGreaterThanOrEqual(5);
    expect(policesDeRepli(buf)).toEqual([]);
  }, 120_000);

  it("Excel : le classeur du modèle (Cuisine, Bar), un nombre vendu est un nombre, « — » pour un jour non saisi", async () => {
    const { buf, nom } = await lire("type=rapport&semaine=2026-09-21&format=excel");
    expect(nom).toBe("Rapport_journalier_2026-09-21.xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Cuisine ", "Bar "]);
    const cuisine = wb.getWorksheet("Cuisine ")!;
    expect(cuisine.getCell("B9").value).toBe("Rapport journalier cuisine ");
    expect(cuisine.getCell("D9").value).toMatchObject({ formula: "WEEKNUM(C12,21)", result: 39 });
    expect(cuisine.getCell("B11").value).toBe("Designation/Date ");
    expect(ligneDe(cuisine, "Carbonara", 7, 1)).toEqual(["Carbonara", 12, 0, "—", "—", "—", "—"]);
    expect(ligneDe(cuisine, "Bolognaise", 7, 1)).toEqual(["Bolognaise", "", "", "", "", "", ""]);
    const bar = wb.getWorksheet("Bar ")!;
    expect(ligneDe(bar, "Coca", 7)).toEqual(["Coca", "—", "—", 24, "—", "—", "—"]);
    expect(ligneDe(bar, "Mojito", 7)).toEqual(["Mojito", "—", "—", "—", "—", "—", 6]);
    expect(rangeesDe(bar).some((r) => String(r[0]).includes("Fanta (") )).toBe(false);
  }, 120_000);

  it("filtre Cuisine : la seule feuille Cuisine ; le dimanche apparaît dès qu'il porte une vente", async () => {
    const ventes = await prisma.venteJournaliere.create({ data: { date: le("2026-09-27"), ficheId: (await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Arrabbiata" } })).id, quantite: 4 } });
    try {
      const { buf, nom } = await lire("type=rapport&semaine=2026-09-21&domaine=NOURRITURE&format=pdf");
      expect(nom).toBe("Rapport_journalier_cuisine_2026-09-21.pdf");
      const pages = await pagesDuPdf(buf);
      const plat = pages.map((p) => p.plat).join(" ");
      expect(plat).toMatch(/Sam\s+Dim/);
      expect(plat).toContain("27-sept.");
      expect(plat).not.toContain("Rapport journalier bar");
      expect(pages.flatMap((p) => p.lignes)).toContain("Arrabbiata — — — — — — 4");
      const x = await lire("type=rapport&semaine=2026-09-21&domaine=NOURRITURE&format=excel");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(x.buf as unknown as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(["Cuisine "]);
      expect(wb.worksheets[0]!.getCell("I11").value).toMatchObject({ result: "Dim" });
    } finally {
      await prisma.venteJournaliere.delete({ where: { id: ventes.id } });
    }
  }, 120_000);
});

describe("fiche « Consommation réelle du restaurant » (l'ancien contenu du rapport journalier)", () => {
  it("PDF : consommation réelle par jour, « — » les jours sans comptage, lundi → samedi", async () => {
    const { buf, nom } = await lire("type=consommation&semaine=2026-09-23&format=pdf");
    expect(nom).toBe("Consommation_reelle_2026-09-21.pdf");
    const pages = await pagesDuPdf(buf);
    const lignes = pages.flatMap((p) => p.lignes);
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat).toContain("Consommation réelle du restaurant");
    expect(plat).toContain("semaine 39, du 21/09/2026 au 26/09/2026");
    expect(plat).toContain("Consommation réelle cuisine — semaine 39");
    expect(plat).toContain("Consommation réelle bar — semaine 39");
    expect(plat).not.toContain("DIM 27/09");
    expect(lignes).toContain("Coca (Bouteille) — 12 — — — —");
    expect(lignes).toContain("Fanta (Bouteille) — — — — — —");
    expect(lignes).toContain("Filet de boeuf (Kg) — — — — — —");
    expect(plat).not.toContain("Carbonara"); // les ventes n'y sont pas
    expect(policesDeRepli(buf)).toEqual([]);
  }, 120_000);

  it("Excel : feuilles « Conso. réelle cuisine » et « Conso. réelle bar », la consommation connue est un nombre", async () => {
    const { buf } = await lire("type=consommation&semaine=2026-09-21&format=excel");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Conso. réelle cuisine", "Conso. réelle bar"]);
    const bar = rangeesDe(wb.getWorksheet("Conso. réelle bar")!);
    expect(bar.find((r) => r[0] === "Désignation/Date")).toEqual(["Désignation/Date", "Lun 21/09", "Mar 22/09", "Mer 23/09", "Jeu 24/09", "Ven 25/09", "Sam 26/09"]);
    expect(bar.find((r) => r[0] === "Coca (Bouteille)")).toEqual(["Coca (Bouteille)", "—", 12, "—", "—", "—", "—"]);
  }, 120_000);
});

describe("paramètres", () => {
  it("date ou semaine illisible, fiche inconnue : refusées (jamais un autre jour à la place)", async () => {
    for (const q of [
      "type=commande&date=2026-02-31", "type=commande&date=hier", "type=rapport&semaine=demain", "type=consommation&semaine=2026-13-01", "type=autre",
      "type=commande&tout=1&semaine=2026-02-30", "type=commande&tout=1&semaine=lundi", "type=commande&tout=1&semaine=",
    ]) {
      expect((await fiche(new Request(`http://pef.test/stock/journalier/fiche?${q}`))).status, q).toBe(400);
    }
  });

  it("garde de l'espace Stock : un compte hors de l'espace est refusé (403), avant toute lecture", async () => {
    H.role = "EMPLOYE";
    try {
      for (const q of ["type=commande&tout=1&semaine=2026-09-21&format=pdf", "type=commande&date=2026-09-22&format=excel"]) {
        const r = await fiche(new Request(`http://pef.test/stock/journalier/fiche?${q}`));
        expect(r.status, q).toBe(403);
        expect(r.headers.get("Content-Type")).not.toContain("pdf");
      }
    } finally {
      H.role = "STOCK";
    }
  });
});
