import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { ecrireSaisieNombre } from "@/lib/nombre";
import { jourKinshasaISO } from "@/lib/date-paiement";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — demande de Sacha du 2026-10-08 : « je veux
// un rattachement automatique » des livraisons au restaurant, sans jamais deviner :
//  - à la sortie « Livraison restaurant » (après sa transaction, jamais bloquant) ;
//  - par le bouton « Rattacher automatiquement (N) » du bandeau (arriéré) ;
//  - un seul candidat → rattaché ; aucun → créé ; plusieurs → laissé, au choix de la Direction ;
//  - les unités ne se corrigent pas toutes seules ; chaque écriture est journalisée « automatique » ;
//  - un compte non-Direction notifie la Direction ; le stock théorique relit le rattachement.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
const PANNE = vi.hoisted(() => ({ journalAutomatique: false }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
// Droits : la VRAIE règle d'espace (lib/espaces → estStock) ; un compte RH sans accès Stock est refusé.
vi.mock("@/lib/auth", async () => {
  const { estStock } = await import("@/lib/espaces");
  return {
    verifySession: async () => A.user,
    requireModule: (u: Parameters<typeof estStock>[0], espace: string) => { if (espace === "stock" && !estStock(u)) throw new Error("Accès refusé : module non autorisé."); },
    requireRole: () => {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
// Panne CIBLÉE de l'écriture du journal « automatique » : la transaction du rattachement échoue.
vi.mock("@/lib/audit", async (orig) => {
  const m = await orig<typeof import("@/lib/audit")>();
  return {
    ...m,
    journaliserPlusieurs: async (c: Parameters<typeof m.journaliserPlusieurs>[0], e: Parameters<typeof m.journaliserPlusieurs>[1]) => {
      if (PANNE.journalAutomatique && e.some((x) => x.champ.includes("automatique"))) throw new Error("panne du journal");
      return m.journaliserPlusieurs(c, e);
    },
  };
});

const { mouvementManuel } = await import("../mouvements/actions");
const { rattacherLivraisonsAutomatiquement } = await import("./actions");
const { rattacherAutomatiquement } = await import("@/lib/rattachement-auto");
const { chargerEntreesStockResto } = await import("@/lib/stock-restaurant-charger");
const { stockRestaurantTheorique } = await import("@/lib/stock-restaurant");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = {
  dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false },
  resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false },
  rh: { id: "", role: "MANAGER", nom: "Rita", accesStock: false },
};
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) {
    const u = await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" | "MANAGER" } });
    U[k].id = u.id;
  }
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  PANNE.journalAutomatique = false;
  en("dir");
  await prisma.notification.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.comptageResto.deleteMany();
  await prisma.articleResto.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.categorieStock.deleteMany();
});

const DATE = jourKinshasaISO();
const jour = (iso: string) => new Date(`${iso}T00:00:00Z`);
const veille = (iso: string, n = 1) => { const d = jour(iso); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

const article = async (designation: string, o: { unite?: string | null; domaine?: "NOURRITURE" | "BOISSON" | "AUTRE"; nomCourt?: string; categorie?: string } = {}) => {
  const domaine = o.domaine ?? "NOURRITURE";
  const categorieId = o.categorie ? (await prisma.categorieStock.create({ data: { nom: o.categorie, domaine } })).id : null;
  const a = await prisma.articleStock.create({ data: { designation, domaine, unite: o.unite === undefined ? "Paquet" : o.unite, nomCourt: o.nomCourt ?? null, categorieId } });
  await prisma.stock.create({ data: { articleId: a.id, quantite: 100 } });
  return a.id;
};
const resto = (designation: string, o: { espace?: "CUISINE" | "BAR"; unite?: string | null; articleStockId?: string; actif?: boolean } = {}) =>
  prisma.articleResto.create({ data: { espace: o.espace ?? "CUISINE", designation, unite: o.unite === undefined ? "Paquet" : o.unite, articleStockId: o.articleStockId ?? null, actif: o.actif ?? true } });
/** Arriéré : une sortie « Livraison restaurant » déjà en base (avant la règle). */
const livraisonPassee = (articleId: string, quantite: number, date = DATE) =>
  prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", quantite, date: jour(date), categorieSortie: "LIVRAISON_RESTAURANT", origine: "Livraison restaurant" } });
const sortie = (articleId: string, quantite: number, categorieSortie = "LIVRAISON_RESTAURANT", raisonSortie?: string) => {
  const f = new FormData();
  f.set("type", "SORTIE"); f.set("date", DATE); f.set("categorieSortie", categorieSortie);
  if (raisonSortie) f.set("raisonSortie", raisonSortie);
  f.append("articleId", articleId); f.append("quantite", ecrireSaisieNombre(quantite));
  return f;
};
const rattacheA = async (articleStockId: string) => prisma.articleResto.findMany({ where: { articleStockId }, orderBy: { designation: "asc" } });
const journal = () => prisma.journalAudit.findMany({ where: { entite: "ArticleResto" }, orderBy: { date: "asc" } });
const message = (r: unknown) => (r as { message: string }).message;

describe("à la sortie « Livraison restaurant » (après la transaction, jamais bloquant)", () => {
  it("(b) aucun article du restaurant : créé, rattaché, avec l'unité, la catégorie et la désignation du catalogue ; stock de base vide", async () => {
    const farfalle = await article("Farfalle Molisana", { categorie: "Pâtes" });
    await resto("Penne"); // ordre 0 : le nouvel article passe après
    en("resp");
    const r = await mouvementManuel(sortie(farfalle, 2));
    expect(message(r)).toBe("Sortie enregistrée : stock décrémenté. Restaurant : « Farfalle Molisana » (Cuisine) ajouté au stock du restaurant.");
    const [cree] = await rattacheA(farfalle);
    expect(cree).toMatchObject({ espace: "CUISINE", designation: "Farfalle Molisana", unite: "Paquet", categorie: "Pâtes", stockBaseJournalier: null, actif: true, ordre: 1 });
    const j = await journal();
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ entiteId: cree!.id, champ: "creation (automatique)", userId: U.resp.id });
    expect(j[0]!.nouvelleValeur).toContain(farfalle);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: farfalle } })).quantite)).toBe(98);
  }, 60_000);

  it("nom court du catalogue pour la désignation créée ; boisson → Bar ; sans catégorie → « À classer »", async () => {
    const jd = await article("JACK DANIELS OLD N°7 70CL", { nomCourt: "Jack Daniel's", domaine: "BOISSON", unite: "Bouteille" });
    await mouvementManuel(sortie(jd, 1));
    expect(await rattacheA(jd)).toMatchObject([{ espace: "BAR", designation: "Jack Daniel's", unite: "Bouteille", categorie: "À classer" }]);
  }, 60_000);

  it("(a) un seul article du restaurant au même nom (accents, contenance) : rattaché, pas de doublon ; journal « automatique »", async () => {
    const eau = await article("Eau Vivreau 1L", { domaine: "BOISSON", unite: "Bouteille" });
    const r1 = await resto("EAU VIVREAU 100 cl", { espace: "BAR", unite: "Bouteille" });
    await mouvementManuel(sortie(eau, 6));
    expect((await rattacheA(eau)).map((x) => x.id)).toEqual([r1.id]);
    expect(await prisma.articleResto.count()).toBe(1);
    expect(await journal()).toMatchObject([{ entiteId: r1.id, champ: "articleStockId (automatique)", ancienneValeur: null, nouvelleValeur: eau, userId: U.dir.id }]);
  }, 60_000);

  it("(c) plusieurs candidats : rien n'est écrit, la sortie le dit", async () => {
    const citron = await article("Citron", { domaine: "AUTRE" });
    await resto("Citron"); await resto("citron", { espace: "BAR" });
    const r = await mouvementManuel(sortie(citron, 3));
    expect(message(r)).toContain("à rattacher à la main dans Stock → Restaurant : « Citron » (2 articles du restaurant portent ce nom");
    expect(await rattacheA(citron)).toEqual([]);
    expect(await prisma.articleResto.count()).toBe(2);
    expect(await journal()).toEqual([]);
  }, 60_000);

  it("une perte ne rattache rien ; un article déjà rattaché ne bouge pas", async () => {
    const riz = await article("Riz");
    await mouvementManuel(sortie(riz, 1, "PERTE", "Avarie"));
    expect(await prisma.articleResto.count()).toBe(0);
    const sel = await article("Sel");
    const rs = await resto("Sel de cuisine", { articleStockId: sel });
    const r = await mouvementManuel(sortie(sel, 1));
    expect(message(r)).toBe("Sortie enregistrée : stock décrémenté.");
    expect((await rattacheA(sel)).map((x) => x.id)).toEqual([rs.id]);
    expect(await journal()).toEqual([]);
  }, 60_000);

  it("une entrée (même « Retour restaurant ») ne rattache rien", async () => {
    const riz = await article("Riz");
    const f = new FormData();
    f.set("type", "ENTREE"); f.set("date", DATE); f.set("motifEntree", "RETOUR_RESTAURANT");
    f.append("articleId", riz); f.append("quantite", ecrireSaisieNombre(1));
    await mouvementManuel(f);
    expect(await prisma.articleResto.count()).toBe(0);
  }, 60_000);

  it("panne au milieu d'un LOT : rien n'est écrit (ni le rattachement déjà fait, ni la création)", async () => {
    const [sel, riz] = await Promise.all([article("Sel"), article("Riz")]);
    const rs = await resto("Sel");
    await livraisonPassee(sel, 1); await livraisonPassee(riz, 1);
    PANNE.journalAutomatique = true;
    expect(await rattacherLivraisonsAutomatiquement([sel, riz])).toMatchObject({ erreur: expect.stringContaining("rien n'a été écrit") });
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: rs.id } })).articleStockId).toBeNull();
    expect(await prisma.articleResto.count()).toBe(1);
  }, 60_000);

  it("le rattachement tombe en panne : la sortie est ENREGISTRÉE quand même, rien n'est rattaché à moitié, l'auteur est prévenu", async () => {
    const farine = await article("Farine");
    PANNE.journalAutomatique = true;
    const r = await mouvementManuel(sortie(farine, 4));
    expect(message(r)).toContain("Sortie enregistrée : stock décrémenté.");
    expect(message(r)).toContain("Le rattachement automatique n'a pas pu se faire (rien n'a été écrit)");
    expect(await prisma.mouvementStock.count({ where: { articleId: farine, categorieSortie: "LIVRAISON_RESTAURANT" } })).toBe(1);
    expect(Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: farine } })).quantite)).toBe(96);
    expect(await prisma.articleResto.count()).toBe(0); // la création a été annulée avec le journal
  }, 60_000);

  it("compte non-Direction : UNE seule notification par Direction (celle de la sortie), le rattachement est au journal de l'auteur", async () => {
    const tomate = await article("Tomate pelée", { categorie: "Conserves" });
    en("resp");
    await mouvementManuel(sortie(tomate, 2));
    const n = await prisma.notification.findMany({ where: { destinataireUserId: U.dir.id } });
    expect(n.map((x) => x.message)).toEqual(["Sortie de 2 Paquets — Tomate pelée (Livraison restaurant) par Jean"]);
    expect(await journal()).toMatchObject([{ champ: "creation (automatique)", userId: U.resp.id }]);
  }, 60_000);

  it("deux sorties simultanées du même article nouveau : UN seul article du restaurant créé (verrou)", async () => {
    const oeuf = await article("Oeufs");
    await Promise.all([livraisonPassee(oeuf, 1), livraisonPassee(oeuf, 2)]);
    await Promise.all([rattacherAutomatiquement({ id: U.dir.id, nom: "Sacha", role: "ADMIN" }, [oeuf], "SORTIE"), rattacherAutomatiquement({ id: U.dir.id, nom: "Sacha", role: "ADMIN" }, [oeuf], "SORTIE")]);
    expect(await rattacheA(oeuf)).toHaveLength(1);
  }, 60_000);
});

describe("bouton « Rattacher automatiquement (N) » : l'arriéré, en lot", () => {
  it("arriéré mixte : rattachés / créés / laissés avec la raison ; unités à corriger intactes ; id jamais livré ignoré", async () => {
    const [beurre, farfalle, citron, vin, jamaisLivre, gaz] = await Promise.all([
      article("Beurre", { unite: "kg" }), article("Farfalle Molisana"), article("Citron", { domaine: "AUTRE" }),
      article("Vin rouge", { domaine: "BOISSON", unite: "l" }), article("Lait"), article("Gaz", { domaine: "AUTRE", unite: "Bouteille" }),
    ]);
    const rb = await resto("Beurre", { unite: "g" });
    await resto("Citron"); await resto("Citron ", { espace: "BAR" });
    // Unités incompatibles, déjà rattaché : à corriger À LA MAIN — le bouton n'y touche pas.
    const rv = await resto("Vin rouge", { espace: "BAR", unite: "bouteille", articleStockId: vin });
    for (const id of [beurre, farfalle, citron, vin, gaz]) await livraisonPassee(id, 2);

    const r = await rattacherLivraisonsAutomatiquement([beurre, farfalle, citron, gaz, jamaisLivre]);
    expect(r).toMatchObject({
      rattaches: [{ designationResto: "Beurre", designationCatalogue: "Beurre", espace: "CUISINE" }],
      crees: [{ designation: "Farfalle Molisana", espace: "CUISINE", unite: "Paquet", categorie: "À classer" }],
    });
    const laisses = (r as { laisses: { designationCatalogue: string; raison: string }[] }).laisses;
    expect(laisses.map((l) => l.designationCatalogue)).toEqual(["Citron", "Gaz"]);
    expect(laisses[0]!.raison).toContain("2 articles du restaurant portent ce nom");
    expect(laisses[1]!.raison).toContain("domaine « Autre »");

    expect((await rattacheA(beurre)).map((x) => x.id)).toEqual([rb.id]);
    expect(await rattacheA(citron)).toEqual([]);
    expect(await rattacheA(jamaisLivre)).toEqual([]);
    expect(await prisma.articleResto.findUniqueOrThrow({ where: { id: rv.id } })).toMatchObject({ unite: "bouteille", articleStockId: vin });
    expect((await journal()).map((j) => j.champ).sort()).toEqual(["articleStockId (automatique)", "creation (automatique)"]);

    // Relancé : plus rien à faire pour les écrits, les laissés restent laissés (idempotent).
    const bis = await rattacherLivraisonsAutomatiquement([beurre, farfalle, citron]);
    expect(bis).toMatchObject({ rattaches: [], crees: [] });
    expect(await prisma.articleResto.count()).toBe(5);
  }, 60_000);

  it("le stock théorique du restaurant relit le rattachement : les livraisons de la semaine comptent après le clic", async () => {
    const beurre = await article("Beurre", { unite: "kg" });
    const penne = await article("Penne");
    const rb = await resto("Beurre", { unite: "g" });
    await prisma.comptageResto.create({ data: { articleRestoId: rb.id, date: jour(veille(DATE, 2)), quantite: 500 } }); // 500 g comptés
    await livraisonPassee(beurre, 2, veille(DATE)); // 2 kg livrés la veille
    await livraisonPassee(penne, 3, veille(DATE));
    const charger = () => chargerEntreesStockResto({ depuis: veille(DATE, 6), jusquA: DATE });

    const avant = stockRestaurantTheorique(await charger(), DATE);
    expect(avant.nonRattachees.map((l) => l.designation).sort()).toEqual(["Beurre", "Penne"]);
    expect(avant.parArticle.get(rb.id)!.stock).toBe("500"); // la livraison n'est pas encore additionnée

    await rattacherLivraisonsAutomatiquement([beurre, penne]);
    const apres = stockRestaurantTheorique(await charger(), DATE);
    expect(apres.nonRattachees).toEqual([]);
    expect(apres.parArticle.get(rb.id)!.stock).toBe("2500"); // 500 g + 2 kg, dans l'unité du restaurant
    const [rp] = await rattacheA(penne);
    expect(apres.parArticle.get(rp!.id)).toMatchObject({ stock: "3", aucunComptage: true }); // estimé, jamais 0
  }, 60_000);

  it("droits : un compte RH sans accès Stock est refusé, rien n'est écrit (mêmes droits que le rattachement à la main)", async () => {
    const riz = await article("Riz");
    await livraisonPassee(riz, 1);
    en("rh");
    expect(await rattacherLivraisonsAutomatiquement([riz])).toEqual({ erreur: "Accès refusé : module non autorisé." });
    expect(await prisma.articleResto.count()).toBe(0);
  }, 60_000);

  it("notification : un compte Stock non-Direction notifie la Direction (une fois) ; la Direction elle-même, non", async () => {
    const [riz, sel] = await Promise.all([article("Riz"), article("Sel")]);
    const rs = await resto("Sel");
    await livraisonPassee(riz, 1); await livraisonPassee(sel, 1);
    en("resp");
    await rattacherLivraisonsAutomatiquement([riz, sel]);
    const n = await prisma.notification.findMany();
    expect(n.map((x) => [x.destinataireUserId, x.lien])).toEqual([[U.dir.id, "/stock/restaurant"]]);
    expect(n[0]!.message).toBe("Rattachement automatique au stock du restaurant par Jean — 1 article rattaché (« Sel »), 1 article créé (« Riz »)");
    expect((await journal()).every((j) => j.userId === U.resp.id)).toBe(true);
    expect((await rattacheA(sel)).map((x) => x.id)).toEqual([rs.id]);

    await prisma.notification.deleteMany();
    const poivre = await article("Poivre");
    await livraisonPassee(poivre, 1);
    en("dir");
    await rattacherLivraisonsAutomatiquement([poivre]);
    expect(await prisma.notification.count()).toBe(0);
  }, 60_000);

  it("doublon au catalogue (même nom court) : ni rattaché ni créé, laissé avec la raison", async () => {
    const coca33 = await article("Coca-Cola 33cl", { nomCourt: "Coca", domaine: "BOISSON", unite: "Bouteille" });
    await article("Coca-Cola 50cl", { nomCourt: "Coca", domaine: "BOISSON", unite: "Bouteille" }); // jamais livré
    await resto("Coca", { espace: "BAR", unite: "Bouteille" });
    await livraisonPassee(coca33, 6);
    const r = await rattacherLivraisonsAutomatiquement([coca33]);
    expect(r).toMatchObject({ rattaches: [], crees: [], laisses: [{ designationCatalogue: "Coca-Cola 33cl", raison: expect.stringContaining("« Coca-Cola 50cl » porte le même nom au catalogue") }] });
    expect(await rattacheA(coca33)).toEqual([]);
  }, 60_000);

  it("ouvrir la page Restaurant n'écrit rien, même avec un arriéré rattachable", async () => {
    const riz = await article("Riz");
    await livraisonPassee(riz, 1);
    const { default: RestaurantPage } = await import("./page");
    await RestaurantPage({ searchParams: Promise.resolve({}) });
    expect(await prisma.articleResto.count()).toBe(0);
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);
});
