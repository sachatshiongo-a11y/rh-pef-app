import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// STOCK INITIAL DU MOIS sur une VRAIE base (Postgres éphémère local — jamais la production) : le chargeur lit des
// agrégats SQL (`groupBy` sur une colonne `@db.Date`, filtres sur `createdAt`), ce que les tests purs ne voient pas.
// Octobre 2026. Chaque article raconte un cas du réel ; l'attendu est écrit à la main, pas recalculé par le code.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, appels: [] as string[] }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "inv@pef.cd", accesStock: false, employeeId: null } }));
// Le client est enveloppé pour COMPTER chaque lecture (modèle.méthode) : « nombre de requêtes de l'écran borné ».
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      if (typeof v === "function") return (v as (...a: unknown[]) => unknown).bind(H.client);
      if (v && typeof v === "object" && typeof p === "string") {
        return new Proxy(v, { get: (t, q) => { const f = (t as never)[q]; return typeof f === "function" ? (...a: unknown[]) => { H.appels.push(`${p}.${String(q)}`); return (f as (...x: unknown[]) => unknown).apply(t, a); } : f; } });
      }
      return v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} };
});

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ID: Record<string, string> = {};
const J = (iso: string) => new Date(`${iso}T00:00:00Z`);
const T = (iso: string) => new Date(iso);

async function article(nom: string, o: { cree: string; stock: number | null; domaine?: "NOURRITURE" | "BOISSON" }) {
  const a = await prisma.articleStock.create({ data: { designation: nom, code: String(Object.keys(ID).length + 1), domaine: o.domaine ?? "NOURRITURE", unite: "Kg", prixUnitaireUSD: 2, createdAt: T(o.cree) } });
  if (o.stock !== null) await prisma.stock.create({ data: { articleId: a.id, quantite: o.stock, stockMinimum: 5 } });
  ID[nom] = a.id;
  return a;
}
const mvt = (nom: string, type: "ENTREE" | "SORTIE" | "AJUSTEMENT", quantite: number, date: string, enregistre = date) =>
  prisma.mouvementStock.create({ data: { articleId: ID[nom], type, quantite, date: J(date), createdAt: T(`${enregistre}T09:00:00Z`) } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "inv@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });

  // A — Riz : 108 au 1er ; octobre +30 −50 ; un comptage le 12 (+5 compté en plus) ; une entrée de novembre déjà enregistrée (+7) → 100 aujourd'hui.
  await article("Riz", { cree: "2026-08-01T08:00:00Z", stock: 100 });
  await mvt("Riz", "ENTREE", 10, "2026-09-20");
  await mvt("Riz", "ENTREE", 30, "2026-10-05", "2026-10-05");
  await mvt("Riz", "SORTIE", 50, "2026-10-10", "2026-10-10");
  await mvt("Riz", "ENTREE", 7, "2026-11-02", "2026-10-13"); // datée de novembre : retirée aussi
  const session = await prisma.sessionComptage.create({ data: { date: J("2026-10-12"), nbArticles: 1, nbEcarts: 1, createdAt: T("2026-10-12T09:00:00Z") } });
  await prisma.ligneComptage.create({ data: { sessionId: session.id, articleId: ID.Riz, designation: "Riz", theorique: 95, physique: 100, ecart: 5 } });
  await mvt("Riz", "AJUSTEMENT", 5, "2026-10-12", "2026-10-12");

  // B — Sucre : créé le 8/10, jamais existé au 1er → « absent ».
  await article("Sucre", { cree: "2026-10-08T08:00:00Z", stock: 12 });
  await mvt("Sucre", "ENTREE", 12, "2026-10-08", "2026-10-08");

  // C — Huile : un ajustement SANS ligne de comptage (sens inconnu) → inconnu.
  await article("Huile", { cree: "2026-08-01T08:00:00Z", stock: 9 });
  await mvt("Huile", "AJUSTEMENT", 3, "2026-10-04", "2026-10-04");

  // D — Sel : stock posé par un import d'inventaire le 3/10 → inconnu.
  await article("Sel", { cree: "2026-08-01T08:00:00Z", stock: 40 });
  const lot = await prisma.importBatch.create({ data: { type: "INVENTAIRE", libelle: "Inventaire septembre 2026", createdAt: T("2026-10-03T08:00:00Z") } });
  await prisma.importOperation.create({ data: { batchId: lot.id, entite: "Stock", entiteId: ID.Sel, action: "UPDATE", avant: { quantite: "30" } } });

  // E — Poivre : créé le 8/10 mais avec un mouvement daté du 15/09 (historique importé) : il existait.
  await article("Poivre", { cree: "2026-10-08T08:00:00Z", stock: 10 });
  await mvt("Poivre", "ENTREE", 4, "2026-09-15", "2026-10-08");
  await mvt("Poivre", "ENTREE", 6, "2026-10-08", "2026-10-08");

  // F — Farine : borne de minuit. Entrée du 30/09 (avant) et du 1er/10 (dans le mois) → 4 au 1er.
  await article("Farine", { cree: "2026-08-01T08:00:00Z", stock: 10 });
  await mvt("Farine", "ENTREE", 4, "2026-09-30", "2026-09-30");
  await mvt("Farine", "ENTREE", 6, "2026-10-01", "2026-10-01");

  // G — Beurre : stock touché hors mouvement après la clôture de septembre (20 figé, 25 aujourd'hui, aucun mouvement) → écart +5.
  await article("Beurre", { cree: "2026-08-01T08:00:00Z", stock: 25 });

  // Clôture de septembre prise le 3/10 à 10 h 30 UTC : stocks de ce moment-là (Riz 108 : les mouvements d'octobre n'existaient pas encore ; Farine 10 : entrée du 1er déjà là).
  const ligne = (nom: string, quantite: number) => ({ articleId: ID[nom], code: "", designation: nom, domaine: "NOURRITURE", unite: "Kg", categorie: "", fournisseur: "", quantite, stockMinimum: 5, prixUnitaireUSD: 2 });
  await prisma.clotureStock.create({ data: { annee: 2026, mois: 9, createdAt: T("2026-10-03T10:30:00Z"), snapshot: { valeurTotaleUSD: 0, lignes: [ligne("Riz", 108), ligne("Farine", 10), ligne("Beurre", 20), ligne("Sel", 30)] } } });
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("chargerDonneesStockInitial — octobre 2026, mois non clôturé", () => {
  it("calcule le stock au 1er de chaque cas, sur de vraies données", async () => {
    const { chargerDonneesStockInitial } = await import("./stock-initial-mois-donnees");
    const { stockInitialArticle } = await import("./stock-initial-mois");
    const d = await chargerDonneesStockInitial(2026, 10);
    const stocks = new Map((await prisma.stock.findMany()).map((s) => [s.articleId, s.quantite.toString()]));
    const r = (nom: string) => stockInitialArticle(d, ID[nom], stocks.get(ID[nom]) ?? null);

    // A : 100 − (30 − 50 + 7) − 5 = 108 ; la entrée de novembre est retirée aussi, le comptage (+5) est signé.
    expect(r("Riz").initial).toEqual({ etat: "ok", quantite: 108 });
    expect(r("Riz")).toMatchObject({ entrees: 30, sorties: 50, ajustements: 5, apres: 7 });
    // La décomposition se recompose en fin de mois : 108 + 30 − 50 + 5 + 7 = 100.
    // B : créé après le 1er → absent (pas 0).
    expect(r("Sucre").initial.etat).toBe("absent");
    // C : ajustement sans comptage retrouvé → inconnu.
    expect(r("Huile").initial).toMatchObject({ etat: "inconnu", raison: expect.stringContaining("ajustement") });
    // D : import d'inventaire → inconnu.
    expect(r("Sel").initial).toMatchObject({ etat: "inconnu", raison: expect.stringContaining("import d'inventaire (03/10/2026)") });
    // E : créé le 8/10 mais mouvement daté d'avant le 1er → il existait : 10 − 6 = 4.
    expect(r("Poivre").initial).toEqual({ etat: "ok", quantite: 4 });
    // F : borne de minuit — l'entrée du 30/09 n'est pas retirée, celle du 1er/10 oui.
    expect(r("Farine").initial).toEqual({ etat: "ok", quantite: 4 });
  });

  it("écart avec la clôture de septembre : seuls les stocks touchés hors mouvement sont signalés", async () => {
    const { chargerDonneesStockInitial } = await import("./stock-initial-mois-donnees");
    const { stockInitialArticle } = await import("./stock-initial-mois");
    const d = await chargerDonneesStockInitial(2026, 10);
    expect(d.cloturePrecedente).toMatchObject({ annee: 2026, mois: 9 });
    const stocks = new Map((await prisma.stock.findMany()).map((s) => [s.articleId, s.quantite.toString()]));
    const r = (nom: string) => stockInitialArticle(d, ID[nom], stocks.get(ID[nom]) ?? null);
    // Riz : la clôture (108 le 3/10, sans mouvement d'octobre encore) donne 108 au 1er = le calcul : aucun écart.
    expect(r("Riz").referenceCloture).toBe(108);
    expect(r("Riz").ecartCloture).toBeUndefined();
    // Farine : instantané 10 contenant l'entrée du 1er (6) → 4 au 1er des deux côtés.
    expect(r("Farine").referenceCloture).toBe(4);
    expect(r("Farine").ecartCloture).toBeUndefined();
    // Beurre : 20 figé, 25 aujourd'hui, aucun mouvement → le calcul (25) s'écarte de la clôture (20) de +5. Rien n'est corrigé.
    expect(r("Beurre").initial).toEqual({ etat: "ok", quantite: 25 });
    expect(r("Beurre").ecartCloture).toEqual({ cloture: 20, calcule: 25, ecart: 5 });
    // Sel (import) : pas de comparaison.
    expect(r("Sel").ecartCloture).toBeUndefined();
    expect(r("Sel").referenceCloture).toBeNull();
  });

  it("mois clôturé : seuls les mouvements DÉJÀ enregistrés à l'instant de l'instantané sont retirés", async () => {
    const { chargerDonneesStockInitial } = await import("./stock-initial-mois-donnees");
    const { stockInitialArticle } = await import("./stock-initial-mois");
    // Septembre est clôturé le 3/10 à 10 h 30 : Farine figée à 10 ; l'entrée du 1er/10 (saisie le 1er) y est ; une sortie du 5/10 (saisie le 5) n'y est pas.
    const d = await chargerDonneesStockInitial(2026, 10, { figeLe: T("2026-10-03T10:30:00Z") });
    const r = stockInitialArticle(d, ID.Farine, "10");
    expect(r.initial).toEqual({ etat: "ok", quantite: 4 }); // 10 − 6
    await mvt("Farine", "SORTIE", 2, "2026-10-05", "2026-10-05"); // saisie après l'instantané
    const d2 = await chargerDonneesStockInitial(2026, 10, { figeLe: T("2026-10-03T10:30:00Z") });
    expect(stockInitialArticle(d2, ID.Farine, "10").initial).toEqual({ etat: "ok", quantite: 4 }); // pas retirée : l'instantané ne la contient pas
    const d3 = await chargerDonneesStockInitial(2026, 10); // stock actuel : 8 (10 − 2)
    expect(stockInitialArticle(d3, ID.Farine, "8").initial).toEqual({ etat: "ok", quantite: 4 });
    await prisma.mouvementStock.deleteMany({ where: { articleId: ID.Farine, type: "SORTIE" } });
  });
});

describe("coût borné : le nombre de lectures ne dépend pas du nombre d'articles", () => {
  it("446 articles de plus ne changent pas le nombre de requêtes du chargeur ; il reste sous 12", async () => {
    const { chargerDonneesStockInitial } = await import("./stock-initial-mois-donnees");
    H.appels = [];
    await chargerDonneesStockInitial(2026, 10);
    const avant = [...H.appels];
    for (let lot = 0; lot < 5; lot++) {
      const arts = await prisma.articleStock.createManyAndReturn({ data: Array.from({ length: 90 }, (_, i) => ({ designation: `Lot ${lot}-${i}`, domaine: "NOURRITURE" as const, createdAt: T("2026-08-01T08:00:00Z") })) });
      await prisma.stock.createMany({ data: arts.map((a) => ({ articleId: a.id, quantite: 3 })) });
      await prisma.mouvementStock.createMany({ data: arts.map((a) => ({ articleId: a.id, type: "ENTREE" as const, quantite: 1, date: J("2026-10-06") })) });
    }
    H.appels = [];
    await chargerDonneesStockInitial(2026, 10);
    expect(H.appels.length).toBe(avant.length);
    expect(H.appels.length).toBeLessThanOrEqual(12);
    expect(H.appels.filter((a) => a === "mouvementStock.groupBy").length).toBeLessThanOrEqual(4);
  }, 120_000);

  it("l'écran Inventaire : lignes avec « Stock début de mois », et un nombre de requêtes identique pour 11 ou 461 articles", async () => {
    const { CatalogueView } = await import("@/app/(stock)/stock/catalogue/_view");
    const rendre = async () => {
      H.appels = [];
      const el = await CatalogueView({ searchParams: Promise.resolve({}) }) as unknown as { props: { rows: { id: string; designation: string; stockDebutMois?: number | null; ecartCloture?: unknown }[]; debutMoisLibelle: string } };
      return { el, appels: [...H.appels] };
    };
    vi.useFakeTimers({ toFake: ["Date"] }); // « aujourd'hui » = 13/10/2026 : le mois courant de l'écran est octobre
    vi.setSystemTime(new Date("2026-10-13T08:00:00Z"));
    let grand: Awaited<ReturnType<typeof rendre>>;
    try { grand = await rendre(); } finally { vi.useRealTimers(); }
    expect(grand.el.props.rows.length).toBeGreaterThanOrEqual(456);
    expect(grand.el.props.debutMoisLibelle).toMatch(/^1er /);
    expect(grand.el.props.debutMoisLibelle).toBe("1er octobre");
    const ligne = (nom: string) => grand.el.props.rows.find((r) => r.designation === nom)!;
    expect(ligne("Riz")).toMatchObject({ stockDebutMois: 108, quantite: "100" });
    expect(ligne("Farine").stockDebutMois).toBe(4);
    expect(ligne("Sucre").stockDebutMois).toBeNull(); // créé après le 1er : « — », pas 0
    expect(ligne("Sel").stockDebutMois).toBeNull(); // import d'inventaire
    expect(ligne("Beurre")).toMatchObject({ stockDebutMois: 25, ecartCloture: { cloture: 20, ecart: 5, periode: "septembre 2026" } });
    expect(ligne("Riz").ecartCloture).toBeUndefined();
    // Même scénario avec peu d'articles : mêmes requêtes (le décompte par modèle.méthode est identique).
    await prisma.articleStock.deleteMany({ where: { designation: { startsWith: "Lot " } } });
    const petit = await rendre();
    expect(petit.el.props.rows.length).toBeLessThan(20);
    const compter = (l: string[]) => Object.fromEntries([...new Set(l)].sort().map((k) => [k, l.filter((x) => x === k).length]));
    expect(compter(grand.appels)).toEqual(compter(petit.appels));
    // Tout l'écran (articles, catégories, hausses, validations, taux, stock début de mois) : 16 lectures mesurées, dont 9 pour le
    // stock au 1er (4 agrégats de mouvements, articles créés, imports, clôture précédente, ajustements + comptages).
    expect(grand.appels.length).toBeLessThanOrEqual(20);
    expect(grand.appels.filter((a) => a === "mouvementStock.groupBy").length).toBe(4);
  }, 120_000);
});
