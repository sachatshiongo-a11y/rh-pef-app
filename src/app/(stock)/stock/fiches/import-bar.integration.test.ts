import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";
import { lireClasseurBar, type ChoixImportBar, type FicheBarLue } from "@/lib/fiches/classeur-bar";

/**
 * « Importer les fiches du bar (classeur Excel) » (Direction) sur une VRAIE base (Postgres
 * éphémère), avec le VRAI classeur de la Direction (fixture sans photos) : droits, simulation sans
 * écriture, application, idempotence, refus de remplacer sans la case, unité inconvertible bloquée,
 * et coût recalculé par le moteur identique à celui du classeur.
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

const { analyserFichesBar, appliquerImportBar } = await import("./import-bar-actions");
const { chargerFichesVues, chargerArticlesDesFiches } = await import("./_data/charger-fiche");
const { construireContexte } = await import("./_data/fiche-calc");
const { calculerCout } = await import("@/lib/fiches/cout");

const FIXTURE = path.join(process.cwd(), "src/lib/fiches/__fixtures__/fiches-bar.xlsx");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let lues: FicheBarLue[];
const ids = { direction: "", stock: "" };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  ids.direction = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.stock = (await prisma.user.create({ data: { email: "stock@pef.test", nom: "Stock", role: "STOCK" } })).id;
  const r = await lireClasseurBar(fs.readFileSync(FIXTURE));
  if (!r.ok) throw new Error(r.erreur);
  lues = r.fiches;
}, 120_000);
afterAll(async () => { await fermer?.(); });

/** Fiches BAR de la production, SANS ingrédient (état relevé le 2026-09-30), + une déjà remplie. */
const FICHES: [string, string][] = [
  ["Pina Colada", "Cocktail"], ["Blue Hawaian", "Cocktail"], ["Mojito", "Cocktail"], ["Cosmopolitain", "Cocktail"], ["Negroni", "Cocktail"],
  ["Pina Colada", "Mocktail"], ["Mojito Virgin", "Mocktail"], ["Kir Royal", "Apéritif"],
];

beforeEach(async () => {
  H.user = { id: ids.direction, role: "ADMIN", accesStock: false, nom: "Direction" };
  await prisma.ingredientFiche.deleteMany();
  await prisma.ficheTechnique.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.journalAudit.deleteMany();
  for (const [nom, categorie] of FICHES) await prisma.ficheTechnique.create({ data: { nom, categorie, type: "BAR", prixVenteTTC: 15, recette: nom === "Negroni" ? "Recette du barman." : null } });
  // Catalogue : le rhum du Mojito existe déjà (même désignation, casse différente) ; la vodka
  // existe en BOUTEILLE (unité qui ne se convertit pas en cl).
  await prisma.articleStock.create({ data: { designation: "Rum Saint James blc 70cl", domaine: "BOISSON", unite: "L", prixUnitaireUSD: 17.8571 } });
  await prisma.articleStock.create({ data: { designation: "ABSOLUT VODKA 75CL", domaine: "BOISSON", unite: "Bouteille", prixUnitaireUSD: 9 } });
});

const comptes = async () => ({
  fiches: await prisma.ficheTechnique.count(), ingredients: await prisma.ingredientFiche.count(),
  articles: await prisma.articleStock.count(), journal: await prisma.journalAudit.count(),
  fichesMaj: (await prisma.ficheTechnique.findMany({ select: { majLe: true } })).map((f) => f.majLe.getTime()).sort().join(","),
});

async function analyser() {
  const a = await analyserFichesBar(lues);
  if (!("ok" in a)) throw new Error(JSON.stringify(a));
  return a;
}

/**
 * Choix « de la Direction » : correspondances sûres acceptées ; toute autre feuille CRÉÉE ; tout
 * ingrédient non reconnu CRÉÉ — sauf ce que `sauf` précise.
 */
async function choixToutCreer(sauf: Partial<{ fiches: ChoixImportBar["fiches"]; ingredients: ChoixImportBar["ingredients"] }> = {}): Promise<ChoixImportBar> {
  const a = await analyser();
  return {
    fiches: { ...Object.fromEntries(a.fiches.map((p) => [p.feuille, { cible: p.ficheId ? `fiche:${p.ficheId}` : "creer", categorie: p.categorieProposee, remplacer: false }])), ...sauf.fiches },
    ingredients: { ...Object.fromEntries(a.ingredients.map((p) => [p.cle, { cible: p.articleId ? `art:${p.articleId}` : "creer", domaine: "BOISSON" as const }])), ...sauf.ingredients },
  };
}

describe("import des fiches du bar", () => {
  it("réservé à la Direction : le rôle Stock est refusé, rien n'est écrit", async () => {
    const avant = await comptes();
    H.user = { id: ids.stock, role: "STOCK", accesStock: false, nom: "Stock" };
    expect(await analyserFichesBar(lues)).toEqual({ erreur: "Accès refusé." });
    expect(await appliquerImportBar(lues, { fiches: {}, ingredients: {} })).toEqual({ erreur: "Accès refusé." });
    expect(await comptes()).toEqual(avant);
  });

  it("la simulation n'écrit RIEN, et ne propose d'office que les correspondances sûres", async () => {
    const avant = await comptes();
    const a = await analyser();
    expect(await comptes()).toEqual(avant);
    const fiches = await prisma.ficheTechnique.findMany({ select: { id: true, nom: true, categorie: true } });
    const nom = (id: string | null) => { const f = fiches.find((x) => x.id === id); return f ? `${f.nom} (${f.categorie})` : null; };
    expect(a.fiches.filter((p) => p.ficheId).map((p) => `${p.feuille} → ${nom(p.ficheId)}`)).toEqual([
      "Pinacolada cocktail → Pina Colada (Cocktail)", "PinaColada mocktail → Pina Colada (Mocktail)", "Blue Hawaiian cocktail → Blue Hawaian (Cocktail)",
      "Virgin Mojito → Mojito Virgin (Mocktail)", "Mojito → Mojito (Cocktail)", "Cosmopolitan → Cosmopolitain (Cocktail)", "Negroni → Negroni (Cocktail)",
    ]);
    expect(a.fiches.find((p) => p.feuille === "Kir royal")!.ficheId).toBeNull(); // Apéritif ≠ Cocktail : à décider
    expect(a.ingredients).toHaveLength(55);
    expect(a.ingredients.filter((p) => p.articleId).map((p) => p.libelle)).toEqual(["RUM SAINT JAMES BLC 70CL", "ABSOLUT VODKA 75CL"]);
  });

  it("application : fiches remplies et créées, articles créés UNE fois, prix des fiches existantes intact ; coût = celui du classeur", async () => {
    // La vodka du catalogue est en bouteille : la Direction choisit de créer un article au litre.
    const vodka = (await analyser()).ingredients.find((p) => p.libelle === "ABSOLUT VODKA 75CL")!;
    const choix = await choixToutCreer({ ingredients: { [vodka.cle]: { cible: "ignorer", domaine: "BOISSON" } } });
    const r = await appliquerImportBar(lues, choix);
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.remplies).toEqual(["Pina Colada", "Pina Colada", "Blue Hawaian", "Mojito Virgin", "Mojito", "Cosmopolitain", "Negroni"]);
    expect(r.creees).toHaveLength(22);
    expect(r.nonEcrites).toEqual([]);
    expect(r.articlesCrees).toHaveLength(53); // 55 libellés − le rhum déjà au catalogue − la vodka ignorée
    expect(r.recettesConservees).toEqual(["Negroni"]);
    expect(r.lignesIgnorees.map((l) => l.fiche)).toEqual(["Sex on the beach", "Cosmopolitain", "Espresso Martini", "Pop Cola"]);

    const pina = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Pina Colada", categorie: "Cocktail" }, include: { ingredients: { orderBy: { ordre: "asc" }, include: { article: true } } } });
    expect(Number(pina.prixVenteTTC)).toBe(15); // jamais touché
    expect(pina.nbPortions).toBe(1);
    expect(pina.recette).toBe("Verre : Verre à cocktail\n\nDans un shaker, versez le rhum blanc, le jus d’ananas, le lait de coco et le sirop de canne Canadou.\nSecouez énergiquement pendant 1 minute afin de bien les mélanger.\nVersez le mélange du shaker dans votre verre long drink.");
    expect(pina.ingredients.map((i) => [i.ordre, i.article!.designation, i.unite, i.quantite.toString(), i.article!.unite, i.article!.prixUnitaireUSD?.toString()])).toEqual([
      [1, "Jus d'Ananas-100", "cl", "12", "l", "2.86"],
      [2, "Lait de Coco", "cl", "5", "l", "0.65"],
      [3, "Sirop de Sucre de canne-70", "cl", "1", "l", "17.1429"],
      [4, "MONIN COCONUT FRUIT 1LTR", "cl", "5", "l", "16"],
      [5, "BACARDI BLC 1L", "cl", "5", "l", "15.5"],
    ]);
    expect(await prisma.articleStock.count({ where: { designation: "Jus d'Ananas-100" } })).toBe(1); // 6 fiches, 1 article
    const mojito = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Mojito", categorie: "Cocktail" }, include: { ingredients: { include: { article: true } } } });
    expect(mojito.ingredients.find((i) => i.unite === "cl" && Number(i.quantite) === 8)!.article!.designation).toBe("Rum Saint James blc 70cl"); // l'existant, pas un doublon
    expect((await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Negroni" } })).recette).toBe("Recette du barman."); // texte existant conservé
    const cosmo = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Cosmopolitain" } });
    expect(cosmo.recette).toContain("Non repris du classeur : ABSOLUT VODKA 75CL (4 cl).");

    // Fiche créée : rubrique du classeur, prix TTC du classeur arrondi au centime.
    const espresso = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Espresso Martini" } });
    expect([espresso.type, espresso.categorie, espresso.prixVenteTTC?.toString(), espresso.tauxTVA.toString()]).toEqual(["BAR", "Cocktail", "14.99", "0.16"]);
    expect((await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Milkshake Pomme" } })).categorie).toBe("Milkshake");
    expect(await prisma.ficheTechnique.count({ where: { nom: "Pop Cola" } })).toBe(2); // Mocktail ET Cocktail

    // Le moteur recalcule le coût : identique au « Total prix de revient HT » du classeur quand tout
    // est valorisé ; « ≥ » (incomplet) quand un article n'a pas de prix — jamais un coût à 0.
    const vues = await chargerFichesVues();
    const ctx = construireContexte(vues, new Map((await chargerArticlesDesFiches()).map((a) => [a.id, a])));
    const cout = (nom: string, categorie: string) => calculerCout(ctx.fiches.get(vues.find((v) => v.nom === nom && v.categorie === categorie)!.id)!, ctx);
    expect(cout("Pina Colada", "Cocktail").coutTotal.toNumber()).toBeCloseTo(2.1221285714, 3);
    expect(cout("Pina Colada", "Cocktail").incomplet).toBe(false);
    expect(cout("Bora Bora", "Mocktail").coutTotal.toNumber()).toBeCloseTo(0.5804, 4);
    const moj = cout("Mojito Virgin", "Mocktail"); // « Feuille de menthe » : prix 0 au classeur → article SANS prix
    expect(moj.incomplet).toBe(true);
    expect(moj.ingredientsSansPrix).toEqual(["Feuille de menthe"]);

    const journal = await prisma.journalAudit.findMany({ select: { entite: true, userId: true } });
    expect(journal.filter((j) => j.entite === "ArticleStock")).toHaveLength(53);
    expect(journal.filter((j) => j.entite === "FicheTechnique")).toHaveLength(29);
    expect(journal.every((j) => j.userId === ids.direction)).toBe(true);
  }, 60_000);

  it("idempotent : relancer (mêmes choix, puis analyse neuve) ne crée ni fiche, ni article, ni ligne", async () => {
    const vodka = (await analyser()).ingredients.find((p) => p.libelle === "ABSOLUT VODKA 75CL")!;
    const sauf = { ingredients: { [vodka.cle]: { cible: "ignorer", domaine: "BOISSON" as const } } };
    const choix = await choixToutCreer(sauf);
    const premier = await appliquerImportBar(lues, choix);
    if (!("ok" in premier)) throw new Error(premier.erreur);
    expect(premier.remplies.length + premier.creees.length).toBe(29);
    const apres = await comptes();

    // 1. Mêmes choix renvoyés : « Créer » retrouve fiches et articles du même nom, déjà remplis.
    expect(await appliquerImportBar(lues, choix)).toEqual({ erreur: expect.stringContaining("Aucune fiche prête") });
    // 2. Analyse neuve : tout est désormais reconnu d'office — et déjà rempli.
    const a = await analyser();
    expect(a.fiches.filter((p) => !p.ficheId)).toEqual([]);
    expect(a.ingredients.filter((p) => !p.articleId)).toEqual([]);
    expect(await appliquerImportBar(lues, await choixToutCreer(sauf))).toEqual({ erreur: expect.stringContaining("Aucune fiche prête") });
    expect(await comptes()).toEqual(apres); // ni fiche, ni ligne, ni article, ni journal, ni fiche réécrite
  }, 60_000);

  it("une fiche déjà remplie n'est remplacée QUE si la case est cochée ; une recette identique n'est pas réécrite", async () => {
    const mojito = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Mojito", categorie: "Cocktail" } });
    const rhum = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Rum Saint James blc 70cl" } });
    await prisma.ingredientFiche.create({ data: { ficheId: mojito.id, articleId: rhum.id, unite: "cl", quantite: 4 } });
    const seule = (remplacer: boolean) => choixToutCreer({
      fiches: Object.fromEntries(lues.map((l) => [l.feuille, { cible: l.feuille === "Mojito" ? `fiche:${mojito.id}` : "ignorer", categorie: "", remplacer }])),
    });

    const sans = await appliquerImportBar(lues, await seule(false));
    expect(sans).toEqual({ erreur: expect.stringContaining("Aucune fiche prête") });
    expect(await prisma.ingredientFiche.count({ where: { ficheId: mojito.id } })).toBe(1);
    expect(await prisma.articleStock.count()).toBe(2); // refus = rien écrit, pas même un article

    const avec = await appliquerImportBar(lues, await seule(true));
    if (!("ok" in avec)) throw new Error(avec.erreur);
    expect(avec.remplies).toEqual(["Mojito"]);
    expect(avec.ignorees).toHaveLength(28);
    expect(avec.articlesCrees).toEqual(["Sirop de Sucre de canne-70", "Scheweppes Soda", "citron", "Feuille de menthe"]); // ceux du Mojito seulement
    expect(await prisma.ingredientFiche.count({ where: { ficheId: mojito.id } })).toBe(5);

    const encore = await appliquerImportBar(lues, await seule(true));
    if (!("ok" in encore)) throw new Error(encore.erreur);
    expect(encore).toMatchObject({ remplies: [], identiques: ["Mojito"], articlesCrees: [] });
  }, 60_000);

  it("unité inconvertible pour l'article choisi : fiche BLOQUÉE, annoncée, jamais écrite", async () => {
    const a = await analyser();
    const vodka = a.ingredients.find((p) => p.libelle === "ABSOLUT VODKA 75CL")!;
    expect(vodka.articleId).not.toBeNull(); // reconnue… mais en « Bouteille »
    const choix = await choixToutCreer();
    const r = await appliquerImportBar(lues, choix);
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.nonEcrites.map((n) => n.feuille)).toEqual(["Sex on the beach cocktail", "Cosmopolitan", "Espresso Martini", "Pop Cola cocktail"]);
    expect(r.nonEcrites[1]!.raisons).toEqual(["ABSOLUT VODKA 75CL : unité inconvertible : cl → Bouteille"]);
    const cosmo = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Cosmopolitain" }, include: { _count: { select: { ingredients: true } } } });
    expect(cosmo._count.ingredients).toBe(0);
    expect(await prisma.ficheTechnique.count({ where: { nom: "Espresso Martini" } })).toBe(0); // pas créée non plus
    // Aucun article créé pour la seule fiche bloquée qui l'emploie (« Patrón XO Café » : Espresso
    // Martini) ; « Espresso », employé aussi par le Spanish latte (écrit), l'est.
    expect(await prisma.articleStock.count({ where: { designation: "Patrón XO Café" } })).toBe(0);
    expect(await prisma.articleStock.count({ where: { designation: "Espresso" } })).toBe(1);

    // Toutes les fiches bloquées ou ignorées : refus en clair, rien n'est écrit.
    await prisma.ingredientFiche.deleteMany(); await prisma.ficheTechnique.deleteMany({ where: { nom: { notIn: FICHES.map((f) => f[0]) } } });
    const avant = await comptes();
    const seulCosmo = await appliquerImportBar(lues, { ...choix, fiches: Object.fromEntries(Object.entries(choix.fiches).map(([k, c]) => [k, k === "Cosmopolitan" ? c : { ...c, cible: "ignorer" }])) });
    expect(seulCosmo).toEqual({ erreur: expect.stringContaining("Aucune fiche prête") });
    expect(await comptes()).toEqual(avant);
  }, 60_000);

  it("charges illisibles refusées en clair (jamais levées)", async () => {
    expect(await analyserFichesBar([])).toEqual({ erreur: "Aucune fiche lue dans le classeur." });
    expect(await analyserFichesBar([{ ...lues[0]!, nom: 12 } as never])).toEqual({ erreur: "Classeur illisible (nom)." });
    expect(await appliquerImportBar(lues, { fiches: { [lues[0]!.feuille]: { cible: "supprimer" } }, ingredients: {} })).toEqual({ erreur: expect.stringContaining("Choix illisible") });
    expect(await appliquerImportBar(lues, null)).toEqual({ erreur: "Choix illisibles." });
  });
});
