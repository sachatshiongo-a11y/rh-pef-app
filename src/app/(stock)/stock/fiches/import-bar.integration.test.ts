import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";
import { choixInitiaux, lireClasseurBar, type ChoixImportBar, type FicheBarLue } from "@/lib/fiches/classeur-bar";

/**
 * « Importer les fiches du bar (classeur Excel) » (Direction) sur une VRAIE base (Postgres
 * éphémère), avec le VRAI classeur de la Direction (fixture sans photos) : droits, simulation sans
 * écriture, application, idempotence, refus de remplacer sans la case, unité inconvertible bloquée,
 * et coût recalculé par le moteur identique à celui du classeur.
 */
const H = vi.hoisted(() => ({
  client: undefined as unknown as PrismaClient,
  user: { id: "", role: "ADMIN" as Role, accesStock: false, nom: "Direction" },
  /** Simule un autre import qui renseigne une contenance ENTRE la lecture et l'écriture de la transaction. */
  concurrent: null as null | ((tx: PrismaClient) => Promise<void>),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      if (p === "$transaction" && H.concurrent) {
        const faire = H.concurrent;
        return (fn: (tx: unknown) => Promise<unknown>, o: unknown) => H.client.$transaction(async (tx) => {
          const articleStock = new Proxy(tx.articleStock, {
            get: (t, q) => q === "updateMany"
              ? async (args: unknown) => { await faire(tx as unknown as PrismaClient); return (t.updateMany as (a: unknown) => unknown)(args); }
              : (t as unknown as Record<string | symbol, unknown>)[q],
          });
          return fn(new Proxy(tx, { get: (t, q) => (q === "articleStock" ? articleStock : (t as unknown as Record<string | symbol, unknown>)[q]) }));
        }, o as never);
      }
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
// Stockage des photos DOUBLÉ (aucun appel réseau) : on compte les envois et les retraits.
const S = vi.hoisted(() => ({
  envoyerPhoto: vi.fn(async (..._a: [unknown, string, Buffer, string]) => {}),
  supprimerPhoto: vi.fn(async (..._a: [unknown, string]) => {}),
  verifierBucketPhotos: vi.fn(async (..._a: [unknown]) => {}),
  avantEcriture: null as null | (() => Promise<void>),
}));
vi.mock("@/lib/fiches/photo-storage", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/fiches/photo-storage")>();
  return {
    ...reel,
    identifiantsSupabase: () => ({ base: "https://exemple.test", key: "cle-de-test" }),
    verifierBucketPhotos: S.verifierBucketPhotos,
    envoyerPhoto: async (...a: [unknown, string, Buffer, string]) => { await S.envoyerPhoto(...a); if (S.avantEcriture) await S.avantEcriture(); },
    supprimerPhoto: S.supprimerPhoto,
  };
});

const { analyserFichesBar, appliquerImportBar, envoyerPhotoFicheImport } = await import("./import-bar-actions");
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
  H.concurrent = null;
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

const journalDe = (js: { champ: string }[]) => js.map((j) => j.champ);
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
async function choixToutCreer(sauf: Partial<ChoixImportBar> = {}): Promise<ChoixImportBar> {
  const a = await analyser();
  return {
    fiches: { ...Object.fromEntries(a.fiches.map((p) => [p.feuille, { cible: p.ficheId ? `fiche:${p.ficheId}` : "creer", categorie: p.categorieProposee, remplacer: false }])), ...sauf.fiches },
    ingredients: { ...Object.fromEntries(a.ingredients.map((p) => [p.cle, { cible: p.articleId ? `art:${p.articleId}` : "creer", domaine: "BOISSON" as const }])), ...sauf.ingredients },
    contenances: { ...sauf.contenances },
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
    // Comme les articles créés d'office par la liste d'achat : aucune ligne Stock (Inventaire : 0 ;
    // disponibilité : « pas de stock », jamais une rupture inventée).
    const crees = await prisma.articleStock.findMany({ where: { designation: { in: r.articlesCrees } }, select: { id: true } });
    expect(crees).toHaveLength(53);
    expect(await prisma.stock.count({ where: { articleId: { in: crees.map((a) => a.id) } } })).toBe(0);
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

  it("« Remplacer » avec une feuille sans technique n'efface pas le texte de recette ; le texte gardé reçoit la note des lignes ignorées", async () => {
    const neg = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Negroni" } });
    const rhum = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Rum Saint James blc 70cl" } });
    await prisma.ingredientFiche.create({ data: { ficheId: neg.id, articleId: rhum.id, unite: "cl", quantite: 4 } });
    // « Pop Cola » (mocktail) n'a ni verre, ni mode, ni technique au classeur : on la vise sur le Negroni.
    const vise = (feuille: string, remplacer: boolean) => choixToutCreer({
      fiches: Object.fromEntries(lues.map((l) => [l.feuille, { cible: l.feuille === feuille ? `fiche:${neg.id}` : "ignorer", categorie: "", remplacer }])),
    });
    const r = await appliquerImportBar(lues, await vise("Pop Cola mocktail", true));
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.remplies).toEqual(["Negroni"]);
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: neg.id } })).recette).toBe("Recette du barman.");

    // Texte existant conservé (sans « Remplacer ») + une ligne ignorée : la note s'y ajoute, une fois.
    await prisma.ingredientFiche.deleteMany({ where: { ficheId: neg.id } });
    const choix = await vise("Negroni", false);
    const gin = (await analyser()).ingredients.find((p) => p.libelle === "HENDRICKS GIN 700ML")!;
    choix.ingredients[gin.cle] = { cible: "ignorer", domaine: "BOISSON" };
    for (let i = 0; i < 2; i++) {
      await prisma.ingredientFiche.deleteMany({ where: { ficheId: neg.id } });
      const r2 = await appliquerImportBar(lues, choix);
      if (!("ok" in r2)) throw new Error(r2.erreur);
      expect(r2.recettesConservees).toEqual(["Negroni"]);
    }
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: neg.id } })).recette).toBe("Recette du barman.\n\nNon repris du classeur : HENDRICKS GIN 700ML (3 cl).");
  }, 60_000);

  it("bouteille sans contenance : fiches BLOQUÉES, annoncées, jamais écrites ; rien de créé pour elles", async () => {
    const r = await appliquerImportBar(lues, await choixToutCreer());
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.nonEcrites.map((n) => n.feuille)).toEqual(["Sex on the beach cocktail", "Cosmopolitan", "Espresso Martini", "Pop Cola cocktail"]);
    expect(r.nonEcrites[1]!.raisons).toEqual(["ABSOLUT VODKA 75CL : contenance de « ABSOLUT VODKA 75CL » à renseigner (1 Bouteille = combien ?)"]);
    const cosmo = await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Cosmopolitain" }, include: { _count: { select: { ingredients: true } } } });
    expect(cosmo._count.ingredients).toBe(0);
    expect(await prisma.ficheTechnique.count({ where: { nom: "Espresso Martini" } })).toBe(0); // pas créée non plus
    // Aucun article créé pour la seule fiche bloquée qui l'emploie (« Patrón XO Café » : Espresso
    // Martini) ; « Espresso », employé aussi par le Spanish latte (écrit), l'est.
    expect(await prisma.articleStock.count({ where: { designation: "Patrón XO Café" } })).toBe(0);
    expect(await prisma.articleStock.count({ where: { designation: "Espresso" } })).toBe(1);
    expect((await prisma.articleStock.findFirstOrThrow({ where: { designation: "ABSOLUT VODKA 75CL" } })).contenance).toBeNull();
  }, 60_000);

  it("contenance lue dans le nom, confirmée : écrite sur l'article DANS la transaction ; le coût de la bouteille se répartit au cl", async () => {
    const a = await analyser();
    const vodka = a.articles.find((x) => x.designation === "ABSOLUT VODKA 75CL")!;
    // Même pré-remplissage que l'écran (choixInitiaux) : 75 cl, lu dans le nom.
    const { contenances } = choixInitiaux(a.fiches, a.ingredients, a.articles);
    expect(contenances[vodka.id]).toEqual({ quantite: "75", unite: "cl", uniteStock: null });
    const r = await appliquerImportBar(lues, await choixToutCreer({ contenances }));
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.nonEcrites).toEqual([]);
    expect(r.contenancesEcrites).toEqual(["ABSOLUT VODKA 75CL : 75 cl"]);
    const art = await prisma.articleStock.findFirstOrThrow({ where: { id: vodka.id } });
    expect([art.unite, art.contenance?.toString(), art.contenanceUnite, art.prixUnitaireUSD?.toString()]).toEqual(["Bouteille", "75", "cl", "9"]);

    // Cosmopolitain : 4 cl de vodka à 9 $ la bouteille de 75 cl = 0,48 $, par le moteur.
    const vues = await chargerFichesVues();
    const ctx = construireContexte(vues, new Map((await chargerArticlesDesFiches()).map((x) => [x.id, x])));
    const cosmo = vues.find((v) => v.nom === "Cosmopolitain")!;
    const cout = calculerCout(ctx.fiches.get(cosmo.id)!, ctx);
    const i = cosmo.lignes.findIndex((l) => l.articleId === vodka.id);
    expect(cout.lignes[i]!.cout!.toString()).toBe("0.48");
    expect(journalDe(await prisma.journalAudit.findMany({ where: { entiteId: vodka.id } }))).toEqual(["contenance"]);
  }, 60_000);

  it("article SANS unité : l'unité de stock choisie est écrite avec la contenance ; sans elle, les fiches restent bloquées", async () => {
    const jus = await prisma.articleStock.create({ data: { designation: "Jus d'Ananas-Ceres-1L", domaine: "BOISSON", prixUnitaireUSD: 2.86 } });
    const a = await analyser();
    const cle = a.ingredients.find((p) => p.libelle === "Jus d'Ananas-100")!.cle;
    const vodka = a.articles.find((x) => x.designation === "ABSOLUT VODKA 75CL")!;
    const base = { ingredients: { [cle]: { cible: `art:${jus.id}`, domaine: "BOISSON" as const } } };
    const sans = await appliquerImportBar(lues, await choixToutCreer({ ...base, contenances: { [vodka.id]: { quantite: "75", unite: "cl", uniteStock: null }, [jus.id]: { quantite: "1", unite: "l", uniteStock: null } } }));
    if (!("ok" in sans)) throw new Error(sans.erreur);
    expect(sans.nonEcrites.map((n) => n.feuille)).toContain("Pinacolada cocktail");
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: jus.id } })).unite).toBeNull();

    await prisma.ingredientFiche.deleteMany();
    const avec = await appliquerImportBar(lues, await choixToutCreer({ ...base, contenances: { [jus.id]: { quantite: "1", unite: "l", uniteStock: "Brique" } } }));
    if (!("ok" in avec)) throw new Error(avec.erreur);
    expect(avec.contenancesEcrites).toContain("Jus d'Ananas-Ceres-1L : 1 l (unité de stock : Brique)");
    const lu = await prisma.articleStock.findUniqueOrThrow({ where: { id: jus.id } });
    expect([lu.unite, lu.contenance?.toString(), lu.contenanceUnite]).toEqual(["Brique", "1", "l"]);
    // 12 cl d'une brique de 1 L à 2,86 $ = 0,3432 $ : le chiffre du classeur.
    const vues = await chargerFichesVues();
    const ctx = construireContexte(vues, new Map((await chargerArticlesDesFiches()).map((x) => [x.id, x])));
    const pina = vues.find((v) => v.nom === "Pina Colada" && v.categorie === "Cocktail")!;
    const i = pina.lignes.findIndex((l) => l.articleId === jus.id);
    expect(calculerCout(ctx.fiches.get(pina.id)!, ctx).lignes[i]!.cout!.toString()).toBe("0.3432");
  }, 60_000);

  it("une contenance déjà renseignée n'est JAMAIS écrasée : elle fait foi, la saisie est ignorée", async () => {
    const vodka = await prisma.articleStock.findFirstOrThrow({ where: { designation: "ABSOLUT VODKA 75CL" } });
    await prisma.articleStock.update({ where: { id: vodka.id }, data: { contenance: 70, contenanceUnite: "cl" } }); // saisie du catalogue
    const r = await appliquerImportBar(lues, await choixToutCreer({ contenances: { [vodka.id]: { quantite: "75", unite: "cl", uniteStock: null } } }));
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.contenancesEcrites).toEqual([]);
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: vodka.id } })).contenance?.toString()).toBe("70");
  }, 60_000);

  it("contenance renseignée par ailleurs PENDANT l'import : refus, tout est annulé, rien n'est écrasé", async () => {
    const a = await analyser();
    const vodka = a.articles.find((x) => x.designation === "ABSOLUT VODKA 75CL")!;
    const avant = await comptes();
    H.concurrent = async (tx) => { await tx.articleStock.update({ where: { id: vodka.id }, data: { contenance: 70, contenanceUnite: "cl" } }); };
    const r = await appliquerImportBar(lues, await choixToutCreer({ contenances: { [vodka.id]: { quantite: "75", unite: "cl", uniteStock: null } } }));
    expect(r).toEqual({ erreur: "« ABSOLUT VODKA 75CL » : sa contenance vient d'être renseignée par ailleurs. Relancez l'import." });
    H.concurrent = null;
    expect(await comptes()).toEqual(avant);
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: vodka.id } })).contenance).toBeNull(); // annulé avec le reste
  }, 60_000);

  it("unité réellement inconvertible (citron compté à l'unité, catalogue au kilo) : bloquée ; contenance illisible : refus en clair", async () => {
    await prisma.articleStock.create({ data: { designation: "Citron", domaine: "NOURRITURE", unite: "Kg", prixUnitaireUSD: 2 } });
    const a = await analyser();
    expect(a.ingredients.find((p) => p.libelle === "citron")!.articleId).not.toBeNull(); // même nom : sûr…
    const vodka = a.articles.find((x) => x.designation === "ABSOLUT VODKA 75CL")!;
    const r = await appliquerImportBar(lues, await choixToutCreer({ contenances: { [vodka.id]: { quantite: "75", unite: "cl", uniteStock: null } } }));
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.nonEcrites.map((n) => [n.feuille, n.raisons])).toEqual([ // … mais inconvertible
      ["Virgin Mojito", ["citron : unité inconvertible : unité → Kg"]],
      ["Mojito", ["citron : unité inconvertible : unité → Kg"]],
      ["Caïpirinha", ["citron : unité inconvertible : unité → Kg"]],
    ]);
    expect(await appliquerImportBar(lues, await choixToutCreer({ contenances: { [vodka.id]: { quantite: "75", unite: "bouteille", uniteStock: null } } })))
      .toEqual({ erreur: "Contenance illisible." });
  }, 60_000);

  it("photos : une par appel, vers la fiche écrite ; jamais par-dessus une photo ; Direction et fiche Bar seulement", async () => {
    const png = () => { const f = new FormData(); f.set("photo", new File([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478da6300010000050001a5f645400000000049454e44ae426082", "hex")], "p.png", { type: "image/png" })); return f; };
    S.envoyerPhoto.mockClear(); S.supprimerPhoto.mockClear();
    const vodka = (await analyser()).ingredients.find((p) => p.libelle === "ABSOLUT VODKA 75CL")!;
    const r = await appliquerImportBar(lues, await choixToutCreer({ ingredients: { [vodka.cle]: { cible: "ignorer", domaine: "BOISSON" } } }));
    if (!("ok" in r)) throw new Error(r.erreur);
    expect(r.fichesEcrites).toHaveLength(29); // la fiche de CHAQUE feuille écrite, pour sa photo
    const pina = r.fichesEcrites.find((x) => x.feuille === "Pinacolada cocktail")!;
    expect(pina.ficheId).toBe((await prisma.ficheTechnique.findFirstOrThrow({ where: { nom: "Pina Colada", categorie: "Cocktail" } })).id);

    expect(await envoyerPhotoFicheImport(pina.ficheId, png())).toEqual({ ok: true, statut: "ENVOYEE" });
    const url = (await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: pina.ficheId } })).photoUrl;
    expect(url).toMatch(/^\/fichiers\/fiches-techniques\//);
    // Relancer : la fiche a une photo → rien n'est envoyé, rien n'est remplacé.
    expect(await envoyerPhotoFicheImport(pina.ficheId, png())).toEqual({ ok: true, statut: "DEJA_UNE_PHOTO" });
    expect(S.envoyerPhoto).toHaveBeenCalledTimes(1);
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: pina.ficheId } })).photoUrl).toBe(url);

    // Une photo posée par ailleurs PENDANT l'envoi : la fiche garde la sienne, l'objet envoyé est retiré.
    const mojito = r.fichesEcrites.find((x) => x.feuille === "Mojito")!;
    S.avantEcriture = async () => { await prisma.ficheTechnique.update({ where: { id: mojito.ficheId }, data: { photoUrl: "/fichiers/fiches-techniques/autre.jpg" } }); };
    expect(await envoyerPhotoFicheImport(mojito.ficheId, png())).toEqual({ ok: true, statut: "DEJA_UNE_PHOTO" });
    S.avantEcriture = null;
    expect(S.supprimerPhoto).toHaveBeenCalledTimes(1);
    expect(S.supprimerPhoto.mock.calls[0]![1]).toMatch(new RegExp(`^fiches-techniques/${mojito.ficheId}-`));
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: mojito.ficheId } })).photoUrl).toBe("/fichiers/fiches-techniques/autre.jpg");

    const plat = await prisma.ficheTechnique.create({ data: { nom: "Bolognaise", type: "PLAT" } });
    expect(await envoyerPhotoFicheImport(plat.id, png())).toEqual({ erreur: "Fiche introuvable ou pas une fiche Bar." });
    H.user = { id: ids.stock, role: "STOCK", accesStock: false, nom: "Stock" };
    expect(await envoyerPhotoFicheImport(pina.ficheId, png())).toEqual({ erreur: "Accès refusé." });
  }, 60_000);

  it("charges illisibles refusées en clair (jamais levées)", async () => {
    expect(await analyserFichesBar([])).toEqual({ erreur: "Aucune fiche lue dans le classeur." });
    expect(await analyserFichesBar([{ ...lues[0]!, nom: 12 } as never])).toEqual({ erreur: "Classeur illisible (nom)." });
    expect(await appliquerImportBar(lues, { fiches: { [lues[0]!.feuille]: { cible: "supprimer" } }, ingredients: {} })).toEqual({ erreur: expect.stringContaining("Choix illisible") });
    expect(await appliquerImportBar(lues, null)).toEqual({ erreur: "Choix illisibles." });
  });
});
