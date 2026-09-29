import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";
import { lireClasseurVentes, type LigneClasseur } from "@/lib/classeur-ventes";

/**
 * « Importer les lignes du classeur » (Direction), sur une
 * VRAIE base (Postgres éphémère) : droits, idempotence, rattachement explicite, journal, et fiches
 * sans recette qui ne passent ni pour « coût 0 » ni pour « disponibles ».
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, user: { id: "", role: "ADMIN" as Role, accesStock: false, nom: "Direction" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => H.user,
  requireModule: (u: { role: Role; accesStock?: boolean }, espace: string) => {
    if (espace !== "stock" || !estStock(u)) throw new Error("Accès refusé : module non autorisé.");
  },
  requireRole: (u: { role: Role }, roles: Role[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { analyserClasseurVentes, appliquerImportClasseur } = await import("./import-classeur-actions");
const { chargerVentesSemaine } = await import("./ventes-data");
const { chargerFichesVues, chargerArticlesDesFiches, chargerStocksDesFiches } = await import("../fiches/_data/charger-fiche");
const { construireContexte, disponibilitesDesFiches, resumerDispo, badgeDispo } = await import("../fiches/_data/fiche-calc");
const { calculerCout } = await import("@/lib/fiches/cout");

const VRAI_CLASSEUR = "/Users/sachatshiongo/Documents/Pâtes en Folie/ PEF Rapport journalier cuisine et bar.xlsx";

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { direction: "", stock: "", duo: "", bolo: "" };
const L = (feuille: "CUISINE" | "BAR", rubrique: string, nom: string, rang: number): LigneClasseur => ({ feuille, rubrique, nom, rang });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  ids.direction = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.stock = (await prisma.user.create({ data: { email: "stock@pef.test", nom: "Stock", role: "STOCK" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  H.user = { id: ids.direction, role: "ADMIN", accesStock: false, nom: "Direction" };
  await prisma.venteJournaliere.deleteMany();
  await prisma.ingredientFiche.deleteMany();
  await prisma.ficheTechnique.deleteMany();
  await prisma.journalAudit.deleteMany();
  ids.duo = (await prisma.ficheTechnique.create({ data: { nom: "Duo de capitaine et de saumon fumé", categorie: "Entrées froides" } })).id;
  ids.bolo = (await prisma.ficheTechnique.create({ data: { nom: "Bolognaise", categorie: "Pâtes classiques" } })).id;
});

const CLASSEUR = [
  L("CUISINE", "Entrées Froides", "Duo de capitaine et saumon fumé et vinaigrette maracuja", 1),
  L("CUISINE", "Entrées Froides", "Salade composée de chez nous", 2),
  L("CUISINE", "Pâtes classiques", "Bolognaise", 3),
  L("CUISINE", "Pâtes", "Penne", 4),
  L("BAR", "Vin blanc", "Vin blanc maison — Verre", 1),
  L("BAR", "Limonade et autre", "Coca", 2),
];

async function appliquerParDefaut(lignes: LigneClasseur[]) {
  const a = await analyserClasseurVentes(lignes);
  if (!("propositions" in a)) throw new Error(JSON.stringify(a));
  const choix = a.propositions.filter((p) => p.action !== "ignorer").map((p) => ({ feuille: p.feuille, nom: p.nom, rubrique: p.rubrique, rang: p.rang, action: p.action as "creer" | "ordre", ficheId: p.ficheId }));
  return { propositions: a.propositions, resultat: await appliquerImportClasseur(choix) };
}

describe("import des lignes du classeur", () => {
  it("réservé à la Direction : le rôle Stock est refusé, rien n'est écrit", async () => {
    H.user = { id: ids.stock, role: "STOCK", accesStock: false, nom: "Stock" };
    expect(await analyserClasseurVentes(CLASSEUR)).toEqual({ erreur: "Accès refusé." });
    expect(await appliquerImportClasseur([{ feuille: "CUISINE", nom: "X", rubrique: "Y", rang: 1, action: "creer" }])).toEqual({ erreur: "Accès refusé." });
    expect(await prisma.ficheTechnique.count()).toBe(2);
  });

  it("choix par défaut : crée les absentes SANS recette, reprend libellé et rang des présentes, laisse « Pâtes » et les « proches » ; journalise", async () => {
    const { resultat } = await appliquerParDefaut(CLASSEUR);
    expect(resultat).toEqual({ ok: true, crees: 3, reprises: 1, dejaPresentes: 0 });
    const fiches = await prisma.ficheTechnique.findMany({ orderBy: [{ type: "asc" }, { ordreVente: "asc" }], include: { _count: { select: { ingredients: true } } } });
    expect(fiches.map((f) => [f.type, f.nom, f.categorie, f.libelleVente, f.ordreVente, f._count.ingredients])).toEqual([
      ["PLAT", "Salade composée de chez nous", "Entrées froides", "Salade composée de chez nous", 2, 0], // orthographe de rubrique de l'application
      ["PLAT", "Bolognaise", "Pâtes classiques", "Bolognaise", 3, 0],
      ["PLAT", "Duo de capitaine et de saumon fumé", "Entrées froides", null, null, 0], // proche : jamais fusionnée d'office
      ["BAR", "Vin blanc maison — Verre", "Vin blanc", "Vin blanc maison — Verre", 1, 0],
      ["BAR", "Coca", "Limonade et autre", "Coca", 2, 0],
    ]);
    expect(await prisma.ficheTechnique.count({ where: { nom: "Penne" } })).toBe(0); // rubrique « Pâtes » décochée
    const journal = await prisma.journalAudit.findMany({ select: { entite: true, champ: true, userId: true } });
    expect(journal).toHaveLength(4);
    expect(journal.every((j) => j.entite === "FicheTechnique" && j.userId === ids.direction)).toBe(true);
  });

  it("idempotent : relancer ne crée aucun doublon (ni par l'analyse, ni par une sélection renvoyée deux fois)", async () => {
    await appliquerParDefaut(CLASSEUR);
    const avant = await prisma.ficheTechnique.count();
    const { propositions, resultat } = await appliquerParDefaut(CLASSEUR);
    expect(propositions.filter((p) => p.action === "creer")).toEqual([]);
    expect(resultat).toMatchObject({ ok: true, crees: 0, reprises: 0 });
    const doublon = await appliquerImportClasseur([{ feuille: "BAR", nom: "Coca", rubrique: "Limonade et autre", rang: 2, action: "creer" }, { feuille: "BAR", nom: "Coca", rubrique: "Limonade et autre", rang: 2, action: "creer" }]);
    expect(doublon).toMatchObject({ ok: true, crees: 0, dejaPresentes: 2 });
    expect(await prisma.ficheTechnique.count()).toBe(avant);
  });

  it("« proche » : la Direction peut dire « c'est cette fiche » — libellé et rang du classeur repris, aucune fiche créée", async () => {
    const r = await appliquerImportClasseur([{ feuille: "CUISINE", nom: "Duo de capitaine et saumon fumé et vinaigrette maracuja", rubrique: "Entrées froides", rang: 1, action: "rattacher", ficheId: ids.duo }]);
    expect(r).toMatchObject({ ok: true, crees: 0, reprises: 1 });
    const duo = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: ids.duo } });
    expect([duo.nom, duo.libelleVente, duo.ordreVente]).toEqual(["Duo de capitaine et de saumon fumé", "Duo de capitaine et saumon fumé et vinaigrette maracuja", 1]);
    // Le rapport l'affiche sous le libellé du classeur, à son rang.
    const v = await chargerVentesSemaine(new Date("2026-09-21T00:00:00Z"), ["CUISINE"]);
    expect(v.lignes.CUISINE[0]!.designation).toBe("Duo de capitaine et saumon fumé et vinaigrette maracuja");
    // Rattacher une ligne Bar à une fiche Plat : refusé en clair, rien n'est écrit.
    expect(await appliquerImportClasseur([{ feuille: "BAR", nom: "Coca", rubrique: "Limonade", rang: 2, action: "rattacher", ficheId: ids.bolo }]))
      .toEqual({ erreur: expect.stringContaining("n'est pas une fiche Bar") });
  });

  it("une fiche créée sans recette : coût « — » (jamais 0), « Recette à compléter » (jamais disponible)", async () => {
    await appliquerParDefaut(CLASSEUR);
    const vues = await chargerFichesVues();
    const [articles, stocks] = await Promise.all([chargerArticlesDesFiches(), chargerStocksDesFiches()]);
    const ctx = construireContexte(vues, new Map(articles.map((a) => [a.id, a])));
    const dispos = disponibilitesDesFiches(vues, articles, stocks, "2026-09-29");
    const coca = vues.find((v) => v.nom === "Coca")!;
    const cout = calculerCout(ctx.fiches.get(coca.id)!, ctx);
    expect(cout.lignes.some((l) => l.cout !== null)).toBe(false); // l'écran affiche « — »
    const d = resumerDispo(dispos.get(coca.id)!, coca);
    expect(d.etat).not.toBe("DISPONIBLE");
    expect(badgeDispo(d, false).texte).toBe("Recette à compléter");
  });

  it("lignes illisibles refusées en clair (jamais levées)", async () => {
    expect(await analyserClasseurVentes([])).toEqual({ erreur: "Aucune ligne lue dans le classeur." });
    expect(await analyserClasseurVentes([{ feuille: "SALLE", rubrique: "x", nom: "y", rang: 1 } as never])).toEqual({ erreur: "Ligne du classeur illisible (feuille)." });
    expect(await appliquerImportClasseur([{ feuille: "CUISINE", nom: "X", rubrique: "Y", rang: 1, action: "fusionner" as never }])).toEqual({ erreur: "Geste inconnu." });
  });

  it.skipIf(!fs.existsSync(VRAI_CLASSEUR))("le VRAI classeur : 50 + 140 lignes lues ; « Pâtes » et « proches » décochés ; relancer = zéro création", async () => {
    const lu = await lireClasseurVentes(fs.readFileSync(VRAI_CLASSEUR));
    if (!lu.ok) throw new Error(lu.erreur);
    await prisma.articleResto.create({ data: { espace: "BAR", designation: "Grey Goose 75cl", ordre: 100 } }); // bouteille du stock bar
    const { propositions, resultat } = await appliquerParDefaut(lu.lignes);
    expect(propositions).toHaveLength(190);
    expect(propositions.filter((p) => p.rubriqueClasseur === "Pâtes").every((p) => p.action === "ignorer")).toBe(true);
    expect(resultat).toMatchObject({ ok: true });
    const bar = (await chargerVentesSemaine(new Date("2026-09-21T00:00:00Z"), ["BAR"])).lignes.BAR;
    expect(bar[0]).toMatchObject({ rubrique: "Eau plate", designation: "Acqua Panna" }); // ordre du classeur
    expect(bar.map((l) => l.designation)).not.toContain("Gery Goose"); // faute de frappe probable (« Grey Goose 75cl ») : décochée
    expect(bar.map((l) => l.designation)).not.toContain("Grey Goose 75cl"); // une bouteille n'est jamais une ligne de vente
    expect(bar).toHaveLength(139);
    const second = await appliquerParDefaut(lu.lignes);
    expect(second.resultat).toMatchObject({ ok: true, crees: 0 });
  }, 120_000);
});
