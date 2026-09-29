import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";
import { lireClasseurCommande, type LigneCommandeClasseur } from "@/lib/classeur-commande";
import { pagesDuPdf } from "@/lib/test/pdf-lecture";

/**
 * Fiche « Commande journalière » sur le modèle du classeur (2026-09-29), sur une VRAIE base :
 * import du classeur (Direction seule, exacte cochée, jamais devinée, nom court posé seulement
 * s'il est vide, idempotent, journalisé), action groupée de l'Inventaire, et fiche qui n'imprime
 * que les articles cochés — plus ceux qui ont une commande ce jour-là, jamais perdus.
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), redirect: () => { throw new Error("redirection"); } }));

const { analyserClasseurCommande, appliquerImportCommande } = await import("./import-commande-actions");
const { basculerFicheCommande, modifierArticle } = await import("../catalogue/actions");
const { GET: fiche } = await import("./fiche/route");
const { ficheCommandeCalee } = await import("./fiches-data");
const { default: PageJournalier } = await import("./page");
const { renderToStaticMarkup } = await import("react-dom/server");
const ecranCommande = async () => renderToStaticMarkup(await PageJournalier({ searchParams: Promise.resolve({ vue: "commande", semaine: "2026-09-21" }) }));
const BANDEAU = "Fiche commande pas encore calée sur votre classeur";

const VRAI_CLASSEUR = `${process.env.HOME}/Downloads/PEF Commande Journalière.xlsx`;
let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids: Record<string, string> = {};
const V = "Viande -Volaille-Poisson-Crustacé";
const L = (nom: string, rang: number, rubrique = `${V} — 1. Viande Rouge`, feuille: "CUISINE" | "BAR" = "CUISINE"): LigneCommandeClasseur => ({ feuille, rubrique, nom, unite: null, rang });
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  ids.direction = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.stock = (await prisma.user.create({ data: { email: "stock@pef.test", nom: "Stock", role: "STOCK" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  H.user = { id: ids.direction, role: "ADMIN", accesStock: false, nom: "Direction" };
  await prisma.commandeResto.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.journalAudit.deleteMany();
  const cat = (await prisma.categorieStock.findFirst({ where: { nom: "Viande" } })) ?? (await prisma.categorieStock.create({ data: { nom: "Viande", domaine: "NOURRITURE" } }));
  const art = async (k: string, designation: string, extra: Record<string, unknown> = {}) =>
    (ids[k] = (await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", categorieId: cat.id, unite: "Kg", ...extra } })).id);
  await art("agneau", "Carré d'agneau");
  await art("hachee", "Viande Hachée", { nomCourt: "Haché maison" });
  await art("lamb", "Lamb Rack NZ Frozen");
  await art("porc", "Côte de porc");
  await art("hors", "Agneau entier (hors fiche)");
  ids.coca = (await prisma.articleStock.create({ data: { designation: "Coca Cola", domaine: "BOISSON" } })).id;
});

describe("import du classeur Commande journalière", () => {
  it("réservé à la Direction", async () => {
    H.user = { id: ids.stock, role: "STOCK", accesStock: false, nom: "Stock" };
    expect(await analyserClasseurCommande([L("Carré d'agneau", 1)])).toEqual({ erreur: "Accès refusé." });
    expect(await appliquerImportCommande([{ articleId: ids.agneau!, feuille: "CUISINE", rubrique: V, rang: 1, nom: "x" }])).toEqual({ erreur: "Accès refusé." });
    expect(await prisma.articleStock.count({ where: { surFicheCommande: true } })).toBe(0);
  });

  it("exacte cochée, proche à choisir ; confirmer pose rang, rubrique et nom court (s'il est vide) ; un nom court existant reste ; journalisé", async () => {
    const a = await analyserClasseurCommande([L("Carré d'agneau", 1), L("Viande Hachée", 2), L("Côtes de porc", 3)]);
    if (!("propositions" in a)) throw new Error(JSON.stringify(a));
    expect(a.propositions.map((p) => [p.nom, p.statut, p.cochee])).toEqual([["Carré d'agneau", "EXACTE", true], ["Viande Hachée", "EXACTE", true], ["Côtes de porc", "PROCHE", false]]);
    const r = await appliquerImportCommande([
      { articleId: ids.agneau!, feuille: "CUISINE", rubrique: `${V} — 1. Viande Rouge`, rang: 1, nom: "Carré d'agneau" },
      { articleId: ids.hachee!, feuille: "CUISINE", rubrique: `${V} — 1. Viande Rouge`, rang: 2, nom: "Viande Hachée" },
      { articleId: ids.porc!, feuille: "CUISINE", rubrique: `${V} — 1. Viande Rouge`, rang: 3, nom: "Côtes de porc" }, // choisi à la main
    ]);
    expect(r).toEqual({ ok: true, places: 3, nomsCourts: 2, dejaAJour: 0, doublons: 0 });
    const vue = async (k: string) => prisma.articleStock.findUniqueOrThrow({ where: { id: ids[k] }, select: { surFicheCommande: true, ordreCommande: true, rubriqueCommande: true, nomCourt: true } });
    expect(await vue("agneau")).toEqual({ surFicheCommande: true, ordreCommande: 1, rubriqueCommande: `${V} — 1. Viande Rouge`, nomCourt: "Carré d'agneau" });
    expect((await vue("hachee")).nomCourt).toBe("Haché maison"); // jamais écrasé sans case explicite
    expect((await vue("porc")).nomCourt).toBe("Côtes de porc");
    expect(await prisma.journalAudit.count({ where: { entite: "ArticleStock", champ: "ficheCommande" } })).toBe(3);

    // Relancer : rien ne change (idempotent) ; la case « remplacer » remplace, elle.
    const bis = await appliquerImportCommande([{ articleId: ids.agneau!, feuille: "CUISINE", rubrique: `${V} — 1. Viande Rouge`, rang: 1, nom: "Carré d'agneau" }]);
    expect(bis).toMatchObject({ places: 0, dejaAJour: 1 });
    await appliquerImportCommande([{ articleId: ids.hachee!, feuille: "CUISINE", rubrique: `${V} — 1. Viande Rouge`, rang: 2, nom: "Viande Hachée", remplacerNomCourt: true }]);
    expect((await vue("hachee")).nomCourt).toBe("Viande Hachée");
  });

  it("un même article pour deux lignes : la première gagne, la seconde est comptée ; un article du bar sur la feuille cuisine est refusé", async () => {
    const r = await appliquerImportCommande([
      { articleId: ids.agneau!, feuille: "CUISINE", rubrique: V, rang: 1, nom: "Carré d'agneau" },
      { articleId: ids.agneau!, feuille: "CUISINE", rubrique: V, rang: 9, nom: "Portions Carre d'agneau" },
    ]);
    expect(r).toMatchObject({ places: 1, doublons: 1 });
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: ids.agneau } })).ordreCommande).toBe(1);
    expect(await appliquerImportCommande([{ articleId: ids.coca!, feuille: "CUISINE", rubrique: "Autres", rang: 1, nom: "Coca" }]))
      .toEqual({ erreur: expect.stringContaining("n'est pas un article de la cuisine") });
  });

  it("la fiche n'imprime que les articles cochés, au rang du classeur, sous sa rubrique ; un non coché commandé ce jour reste, en fin de rubrique", async () => {
    await appliquerImportCommande([
      { articleId: ids.lamb!, feuille: "CUISINE", rubrique: `${V} — 1. Viande Rouge`, rang: 1, nom: "Carré d'agneau" },
      { articleId: ids.porc!, feuille: "CUISINE", rubrique: `${V} — 1. Viande Rouge`, rang: 2, nom: "Côtes de porc" },
    ]);
    await prisma.commandeResto.create({ data: { articleId: ids.hors!, date: le("2026-09-22"), quantite: 2 } });
    const r = await fiche(new Request("http://pef.test/stock/journalier/fiche?type=commande&date=2026-09-22&domaine=NOURRITURE&format=pdf"));
    const lignes = (await pagesDuPdf(Buffer.from(await r.arrayBuffer()))).flatMap((p) => p.lignes);
    const i = (t: string) => lignes.findIndex((l) => l.startsWith(t));
    expect(i(V)).toBeGreaterThanOrEqual(0);
    expect(i(V)).toBeLessThan(i("1. Viande Rouge"));
    expect(i("1. Viande Rouge")).toBeLessThan(i("Carré d'agneau Kg")); // nom court posé par l'import
    expect(i("Carré d'agneau Kg")).toBeLessThan(i("Côtes de porc Kg"));
    expect(lignes).toContain("Agneau entier (hors fiche) Kg 2"); // commandé ce jour : jamais perdu
    // Ni coché, ni commandé : absent, comme dans le classeur (« Viande Hachée » s'imprimerait sous son nom court).
    expect(lignes.some((l) => l.startsWith("Haché maison") || l.startsWith("Viande Hachée"))).toBe(false);
    expect(lignes.filter((l) => l.startsWith("Carré d'agneau"))).toHaveLength(1); // l'article « Carré d'agneau » non coché n'y est pas
    expect(lignes.some((l) => l.includes("Lamb Rack"))).toBe(false);
  }, 120_000);

  it("installation neuve (AUCUN article coché) : la fiche garde l'ancien contenu, tous les articles actifs — sans note dans le PDF", async () => {
    expect(await ficheCommandeCalee()).toBe(false);
    expect(await ecranCommande()).toContain(`${BANDEAU} : lancez « Importer les lignes du classeur Commande journalière ».`); // le remède, sur l'écran
    const r = await fiche(new Request("http://pef.test/stock/journalier/fiche?type=commande&date=2026-09-22&domaine=NOURRITURE&format=pdf"));
    const pages = await pagesDuPdf(Buffer.from(await r.arrayBuffer()));
    const lignes = pages.flatMap((p) => p.lignes);
    for (const n of ["Carré d'agneau", "Haché maison", "Lamb Rack NZ Frozen", "Côte de porc", "Agneau entier (hors fiche)"]) expect(lignes.some((l) => l.startsWith(n)), n).toBe(true);
    expect(pages.map((p) => p.plat).join(" ")).not.toMatch(/calée|Importer les lignes/);
    // Dès qu'un article est coché, la règle du classeur s'applique.
    await basculerFicheCommande([ids.porc!], true);
    expect(await ficheCommandeCalee()).toBe(true);
    expect(await ecranCommande()).not.toContain(BANDEAU);
    const r2 = await fiche(new Request("http://pef.test/stock/journalier/fiche?type=commande&date=2026-09-22&domaine=NOURRITURE&format=pdf"));
    const lignes2 = (await pagesDuPdf(Buffer.from(await r2.arrayBuffer()))).flatMap((p) => p.lignes);
    expect(lignes2.some((l) => l.startsWith("Côte de porc"))).toBe(true);
    expect(lignes2.some((l) => l.startsWith("Lamb Rack"))).toBe(false);
  }, 120_000);

  it.skipIf(!fs.existsSync(VRAI_CLASSEUR))("le VRAI classeur se lit et s'analyse (Direction), sans rien créer", async () => {
    const lu = await lireClasseurCommande(fs.readFileSync(VRAI_CLASSEUR));
    if (!lu.ok) throw new Error(lu.erreur);
    const a = await analyserClasseurCommande(lu.lignes);
    if (!("propositions" in a)) throw new Error(JSON.stringify(a));
    expect(a.propositions.find((p) => p.nom === "Carré d'agneau")).toMatchObject({ statut: "EXACTE", articleId: ids.agneau, cochee: true });
    expect(a.propositions.some((p) => p.statut === "LEGUME")).toBe(true);
    expect(await prisma.articleStock.count()).toBe(6);
  }, 60_000);
});

describe("Inventaire : mettre sur la fiche commande / retirer, en lot", () => {
  it("colonne « Nom court » : saisie enregistrée, case vidée = pas de nom court", async () => {
    const fd = (v: string) => { const f = new FormData(); f.set("nomCourt", v); return f; };
    await modifierArticle(ids.lamb!, fd("  Carré d'agneau  "));
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: ids.lamb } })).nomCourt).toBe("Carré d'agneau");
    await modifierArticle(ids.lamb!, fd(""));
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: ids.lamb } })).nomCourt).toBeNull();
  });

  it("coche et décoche d'un coup, rang et rubrique gardés, journalisé", async () => {
    await appliquerImportCommande([{ articleId: ids.agneau!, feuille: "CUISINE", rubrique: V, rang: 4, nom: "Carré d'agneau" }]);
    expect(await basculerFicheCommande([ids.agneau!, ids.porc!], false)).toEqual({ ok: true, modifies: 1 });
    expect(await prisma.articleStock.findUniqueOrThrow({ where: { id: ids.agneau } })).toMatchObject({ surFicheCommande: false, ordreCommande: 4, rubriqueCommande: V });
    expect(await basculerFicheCommande([ids.agneau!, ids.porc!], true)).toEqual({ ok: true, modifies: 2 });
    expect(await prisma.articleStock.count({ where: { surFicheCommande: true } })).toBe(2);
    expect(await basculerFicheCommande([], true)).toEqual({ erreur: "Aucun article sélectionné." });
    expect(await prisma.journalAudit.count({ where: { champ: "ficheCommande", entiteId: "lot" } })).toBe(2);
  });
});
