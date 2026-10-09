import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { deposerAncienneDemandeMouvement } from "@/lib/test/ancienne-demande-mouvement";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — règle de Sacha du 2026-10-09 :
// « les articles ne peuvent pas tomber sous le seuil de 0. refus de sortir un article en une quantité
// qui le ferait passer en-dessous de 0. si le stock est de 5, on peut en sortir 5, pas 6. proposer un
// article similaire aussi. » Chaque chemin qui diminue un stock est essayé : 5 → 5 accepté, 6 refusé.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/stock;307;" }); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { mouvementManuel, supprimerMouvement, supprimerMouvementsEnLot } = await import("@/app/(stock)/stock/mouvements/actions");
const { supprimerFacture } = await import("@/app/(stock)/stock/factures/actions");
const { fusionnerArticles, modifierArticle, creerArticle, corrigerStocksNegatifs } = await import("@/app/(stock)/stock/catalogue/actions");
const { appliquerMouvements } = await import("@/lib/import-mouvements");
const { validerDemande } = await import("@/lib/validations-stock/demandes");
const { poserStocksTx, sortirDuStockTx } = await import("@/lib/validations-stock/stock-positif");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const JOUR = "2026-10-09";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.ligneFacture.deleteMany();
  await prisma.factureFournisseur.deleteMany();
  await prisma.ligneComptage.deleteMany();
  await prisma.sessionComptage.deleteMany();
  await prisma.importOperation.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.categorieStock.deleteMany();
});

async function article(designation: string, stock: number | null, extra: { unite?: string; domaine?: "NOURRITURE" | "BOISSON" | "AUTRE"; contenance?: number; contenanceUnite?: string } = {}) {
  const a = await prisma.articleStock.create({ data: { designation, domaine: extra.domaine ?? "NOURRITURE", unite: extra.unite ?? "kg", contenance: extra.contenance, contenanceUnite: extra.contenanceUnite } });
  if (stock !== null) await prisma.stock.create({ data: { articleId: a.id, quantite: stock } });
  return a.id;
}
const stockDe = async (id: string) => Number((await prisma.stock.findUnique({ where: { articleId: id } }))?.quantite ?? NaN);
const nbMvts = (id?: string) => prisma.mouvementStock.count({ where: id ? { articleId: id } : {} });

function sortie(lignes: [string, string][], motif = "LIVRAISON_RESTAURANT") {
  const fd = new FormData();
  fd.set("type", "SORTIE"); fd.set("date", JOUR); fd.set("categorieSortie", motif);
  if (motif === "PERTE") fd.set("raisonSortie", "cassé");
  for (const [id, q] of lignes) { fd.append("articleId", id); fd.append("quantite", q); }
  return mouvementManuel(fd);
}
function entree(lignes: [string, string][]) {
  const fd = new FormData();
  fd.set("type", "ENTREE"); fd.set("date", JOUR);
  for (const [id, q] of lignes) { fd.append("articleId", id); fd.append("quantite", q); }
  return mouvementManuel(fd);
}
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);

describe("sortie manuelle (Livraison restaurant, Perte)", () => {
  it("stock 5 : sortir 5 passe (stock 0), sortir 6 est refusé en nommant l'article et son stock", async () => {
    const riz = await article("Riz", 5);
    expect(erreurDe(await sortie([[riz, "5"]]))).toBeNull();
    expect(await stockDe(riz)).toBe(0);

    const huile = await article("Huile", 5, { unite: "L" });
    const r = await sortie([[huile, "6"]], "PERTE");
    expect(erreurDe(r)).toBe("Stock insuffisant — un stock ne passe jamais sous 0 : Huile : 5 L disponibles, 6 L demandés. Rien n'a été enregistré.");
    expect(await stockDe(huile)).toBe(5);
    expect(await nbMvts(huile)).toBe(0);
  });

  it("plusieurs lignes : tout ou rien, chaque article fautif nommé ; deux lignes du même article s'additionnent", async () => {
    const riz = await article("Riz", 10);
    const sel = await article("Sel", 2);
    const sucre = await article("Sucre", 1);
    const r = await sortie([[riz, "4"], [sel, "3"], [sucre, "1,5"]]);
    expect(erreurDe(r)).toContain("Sel : 2 kg disponibles, 3 kg demandés");
    expect(erreurDe(r)).toContain("Sucre : 1 kg disponible, 1,5 kg demandé");
    expect(erreurDe(r)).not.toContain("Riz");
    expect([await stockDe(riz), await stockDe(sel), await stockDe(sucre)]).toEqual([10, 2, 1]);
    expect(await nbMvts()).toBe(0);
    // 3 + 3 sur un stock de 5 : refusé (la somme dépasse) ; 3 + 2 : accepté.
    const farine = await article("Farine", 5);
    expect(erreurDe(await sortie([[farine, "3"], [farine, "3"]]))).toContain("Farine : 5 kg disponibles, 6 kg demandés");
    expect(erreurDe(await sortie([[farine, "3"], [farine, "2"]]))).toBeNull();
    expect(await stockDe(farine)).toBe(0);
  });

  it("décimal exact : 0,1 + 0,2 sortent d'un stock de 0,3 ; 0,301 est refusé", async () => {
    const safran = await article("Safran", 0.3, { unite: "g" });
    expect(erreurDe(await sortie([[safran, "0,301"]]))).toContain("Safran : 0,3 g disponible, 0,301 g demandé");
    expect(erreurDe(await sortie([[safran, "0,1"], [safran, "0,2"]]))).toBeNull();
    expect(await stockDe(safran)).toBe(0);
  });

  it("bouteilles (contenance 75 cl) : la sortie se compte en bouteilles, unité de l'article — 2 sur 2 passe, 2,5 refusé", async () => {
    const vodka = await article("Absolut Vodka-75cl", 2, { unite: "Bouteille", domaine: "BOISSON", contenance: 75, contenanceUnite: "cl" });
    expect(erreurDe(await sortie([[vodka, "2,5"]]))).toContain("Absolut Vodka-75cl : 2 Bouteille disponibles, 2,5 Bouteille demandés");
    expect(erreurDe(await sortie([[vodka, "2"]]))).toBeNull();
    expect(await stockDe(vodka)).toBe(0);
  });

  it("article sans ligne de stock (0) ou DÉJÀ négatif : toute sortie refusée ; une entrée reste possible, le négatif n'est pas réécrit", async () => {
    const neuf = await article("Poivre", null);
    expect(erreurDe(await sortie([[neuf, "1"]]))).toContain("Poivre : 0 kg disponible, 1 kg demandé");
    expect(await prisma.stock.count({ where: { articleId: neuf } })).toBe(0);

    const negatif = await article("Beurre", -3);
    expect(erreurDe(await sortie([[negatif, "1"]]))).toContain("Beurre : stock déjà négatif (-3 kg), 1 kg demandé");
    expect(await stockDe(negatif)).toBe(-3);
    expect(erreurDe(await entree([[negatif, "1"]]))).toBeNull();
    expect(await stockDe(negatif)).toBe(-2);
  });

  it("un compte non-Direction est soumis à la même règle", async () => {
    en("resp");
    const riz = await article("Riz", 5);
    expect(erreurDe(await sortie([[riz, "6"]]))).toContain("Riz : 5 kg disponibles");
    expect(erreurDe(await sortie([[riz, "5"]]))).toBeNull();
  });

  it("CONCURRENCE : deux sorties simultanées de 3 sur un stock de 5 — une seule passe, stock 2", async () => {
    const riz = await article("Riz", 5);
    const rs = await Promise.all([sortie([[riz, "3"]]), sortie([[riz, "3"]])]);
    const refus = rs.map(erreurDe).filter((e) => e !== null);
    expect(refus).toHaveLength(1);
    expect(refus[0]).toContain("Riz : 2 kg disponibles, 3 kg demandés");
    expect(await stockDe(riz)).toBe(2);
    expect(await nbMvts(riz)).toBe(1);
  });

  it("CONCURRENCE (porte, chevauchement forcé) : la seconde sortie attend la première et relit 2 — refusée", async () => {
    const riz = await article("Riz", 5);
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // T1 retire 3 puis garde sa transaction ouverte ; T2 démarre pendant ce temps. Sans le verrou,
    // T2 lirait encore 5 et passerait : stock −1.
    const t1 = prisma.$transaction(async (tx) => { await sortirDuStockTx(tx, [{ articleId: riz, quantite: 3 }]); await pause(400); });
    await pause(100);
    const t2 = prisma.$transaction((tx) => sortirDuStockTx(tx, [{ articleId: riz, quantite: 3 }]));
    const [r1, r2] = await Promise.allSettled([t1, t2]);
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("rejected");
    expect(String((r2 as PromiseRejectedResult).reason?.message)).toContain("Riz : 2 kg disponibles, 3 kg demandés");
    expect(await stockDe(riz)).toBe(2);
  });

  it("propose les articles proches du même domaine qui ont du stock (jamais de remplacement automatique)", async () => {
    const tomate = await article("Tomate", 1);
    const tomates = await article("Tomates", 12);
    await article("Tomates cerises vides", 0); // proche mais sans stock : pas proposé
    await article("Tomates", 4, { domaine: "AUTRE" }); // autre domaine : pas proposé
    await article("Oignons", 30); // en stock mais pas proche
    const r = await sortie([[tomate, "3"]]);
    const refus = r as { erreur: string; insuffisants: { articleId: string; disponible: number; demande: number; proches: { id: string; designation: string; disponible: number }[] }[] };
    expect(refus.insuffisants).toHaveLength(1);
    expect(refus.insuffisants[0]).toMatchObject({ articleId: tomate, disponible: 1, demande: 3 });
    expect(refus.insuffisants[0]!.proches).toEqual([{ id: tomates, designation: "Tomates", unite: "kg", disponible: 12 }]);
    expect(await stockDe(tomate)).toBe(1); // rien d'écrit, rien de remplacé
    expect(await stockDe(tomates)).toBe(12);
  });
});

describe("autres chemins qui diminuent un stock", () => {
  it("supprimer une ENTRÉE déjà consommée : refusé (unité et lot) ; consommée en partie mais couverte : accepté", async () => {
    const riz = await article("Riz", 0);
    await entree([[riz, "5"]]);
    await sortie([[riz, "4"]]);
    const e = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: riz, type: "ENTREE" } });
    expect(erreurDe(await supprimerMouvement(e.id))).toContain("Riz : 1 kg disponible, 5 kg à reprendre");
    expect(erreurDe(await supprimerMouvementsEnLot([e.id]))).toContain("Riz : 1 kg disponible, 5 kg à reprendre");
    expect(await nbMvts(riz)).toBe(2);
    // L'entrée ET la sortie supprimées ensemble : effet net −1 sur un stock de 1 → 0, accepté.
    const s = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: riz, type: "SORTIE" } });
    expect(erreurDe(await supprimerMouvementsEnLot([e.id, s.id]))).toBeNull();
    expect(await stockDe(riz)).toBe(0);
  });

  it("supprimer une facture dont les entrées sont consommées : refusé, rien de supprimé", async () => {
    const riz = await article("Riz", 2);
    const f = await prisma.factureFournisseur.create({ data: { fournisseurNom: "Marché", montantUSD: 10, montantRegleUSD: 0, resteAPayerUSD: 10, mois: 10, annee: 2026 } });
    await prisma.mouvementStock.create({ data: { articleId: riz, type: "ENTREE", quantite: 5, date: new Date(`${JOUR}T00:00:00Z`), factureId: f.id } });
    expect(erreurDe(await supprimerFacture(f.id))).toContain("Riz : 2 kg disponibles, 5 kg à reprendre");
    expect(await prisma.factureFournisseur.count()).toBe(1);
    expect(await stockDe(riz)).toBe(2);
    await prisma.stock.update({ where: { articleId: riz }, data: { quantite: 5 } });
    expect(erreurDe(await supprimerFacture(f.id))).toBeNull();
    expect(await stockDe(riz)).toBe(0);
  });

  it("import de mouvements : un effet net sous 0 refuse tout l'import ; net à 0 passe", async () => {
    const riz = await article("Riz basmati", 5);
    await expect(appliquerMouvements("Date,Code,Désignation,Entrées,Sorties\n09/10/2026,,Riz basmati,0,6", "Import", JOUR, U.dir.id)).rejects.toThrow("Riz basmati : 5 kg disponibles, 6 kg demandés");
    expect(await nbMvts(riz)).toBe(0);
    expect(await stockDe(riz)).toBe(5);
    await appliquerMouvements("Date,Code,Désignation,Entrées,Sorties\n09/10/2026,,Riz basmati,1,6", "Import", JOUR, U.dir.id);
    expect(await stockDe(riz)).toBe(0);
  });

  it("validation d'une ANCIENNE demande de sortie (MOUVEMENT_MANUEL) qui dépasse : refusée", async () => {
    const riz = await article("Riz", 5);
    const d = await deposerAncienneDemandeMouvement(prisma, { auteur: { id: U.resp.id, nom: "Jean" }, type: "SORTIE", date: JOUR, origine: "Sortie / consommation", lignes: [[riz, 6]] });
    await expect(validerDemande({ id: U.dir.id, role: "ADMIN", nom: "Sacha" } as never, d.id, { version: d.updatedAt.toISOString(), motif: { categorie: "LIVRAISON_RESTAURANT" } })).rejects.toThrow("Riz : 5 kg disponibles, 6 kg demandés");
    expect(await stockDe(riz)).toBe(5);
  });

  it("fusion : un doublon négatif qui ferait passer l'article conservé sous 0 est refusé ; couvert, accepté", async () => {
    const a = await article("Crème", 2);
    const b = await article("Creme", -5);
    expect(erreurDe(await fusionnerArticles([a, b], a))).toContain("Crème : 2 kg disponibles, 5 kg à retirer (stock négatif du doublon)");
    expect(await prisma.articleStock.count()).toBe(2);
    await prisma.stock.update({ where: { articleId: b }, data: { quantite: -2 } });
    expect(erreurDe(await fusionnerArticles([a, b], a))).toBeNull();
    expect(await stockDe(a)).toBe(0);
  });

  it("quantités POSÉES : jamais négatives (fiche article, création, comptage) ; la remise à 0 d'un négatif passe", async () => {
    const riz = await article("Riz", 5);
    const fd = new FormData(); fd.set("quantite", "-1");
    expect(erreurDe(await modifierArticle(riz, fd))).toContain("ne peut pas être négative");
    expect(await stockDe(riz)).toBe(5);
    const c = new FormData(); c.set("designation", "Mil"); c.set("quantite", "-2");
    expect(erreurDe(await creerArticle(c))).toContain("ne peut pas être négatif");
    expect(await prisma.articleStock.count({ where: { designation: "Mil" } })).toBe(0);
    await expect(prisma.$transaction((tx) => poserStocksTx(tx, [{ articleId: riz, quantite: "-0.5" }], { quoi: "La quantité comptée" }))).rejects.toThrow("La quantité comptée ne peut pas être négative — un stock ne passe jamais sous 0 : Riz (-0,5 kg)");
    // Un négatif DÉJÀ en base reposé tel quel (ligne de comptage en conflit) n'est pas refusé.
    const beurre = await article("Beurre", -3);
    await prisma.$transaction((tx) => poserStocksTx(tx, [{ articleId: beurre, quantite: "-3" }]));
    expect(await stockDe(beurre)).toBe(-3);
    expect(erreurDe(await corrigerStocksNegatifs([beurre]))).toBeNull();
    expect(await stockDe(beurre)).toBe(0);
  });
});
