import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Unité en MASSE (Direction, 2026-10-14 : « on ne peut pas changer l'unité de plusieurs articles en actions groupées »).
// Postgres éphémère, vraies actions. RIEN n'est converti : les quantités et les prix gardent les mêmes chiffres dans la
// nouvelle unité. Direction : appliqué (après confirmation quand des articles ont du stock/historique/prix/fiche/rattachement) ;
// autre rôle : PROPOSÉ, la Direction approuve.
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

const { changerUniteEnMasse } = await import("./actions");
const { validerDemandes } = await import("../a-valider/actions");
const { apercusDemandes } = await import("@/lib/validations-stock/apercu");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
type Confirmation = { confirmation: true; apercu: { aConfirmer: { id: string; designation: string; avant: string | null; apres: string; raisons: string[]; alertes: string[] }[]; confirmes: string[]; resume: string; nbChangent: number } };
const estConfirmation = (r: unknown): r is Confirmation => !!r && typeof r === "object" && "confirmation" in r;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const k of Object.keys(U) as (keyof typeof U)[]) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role: U[k].role as "ADMIN" | "STOCK" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.ficheTechnique.deleteMany();
  await prisma.articleResto.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const art = async (designation: string, o: { unite?: string | null; quantite?: number; prix?: number } = {}) =>
  (await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: o.unite === undefined ? "kg" : o.unite, prixUnitaireUSD: o.prix ?? null, stock: { create: { quantite: o.quantite ?? 0 } } } })).id;
const unite = async (id: string) => (await prisma.articleStock.findUniqueOrThrow({ where: { id } })).unite;
const journal = (champ: string) => prisma.journalAudit.findMany({ where: { champ }, orderBy: { date: "asc" } });

describe("Direction : changement d'unité en masse", () => {
  it("articles SANS stock ni historique : écrit tout de suite, sans confirmation, avec l'ancienne et la nouvelle unité au journal", async () => {
    const a = await art("Cannelle"), b = await art("Muscade", { unite: "Pièce" });
    const r = await changerUniteEnMasse([a, b], "g");
    expect(erreurDe(r)).toBeNull();
    expect(r).toMatchObject({ proposition: false, message: "Unité « g » appliquée à 2 articles." });
    expect(await unite(a)).toBe("g");
    expect(await unite(b)).toBe("g");
    const lignes = await journal("unite (masse)");
    const parArticle = lignes.filter((l) => l.entiteId === a || l.entiteId === b).map((l) => `${l.entiteId === a ? "a" : "b"}: ${l.ancienneValeur} → ${l.nouvelleValeur}`).sort();
    expect(parArticle).toEqual(["a: kg → g", "b: Pièce → g"]);
    expect(lignes.find((l) => l.entiteId === "2 articles")?.nouvelleValeur).toBe("g : 2 article(s)");
    expect(lignes.every((l) => l.userId === U.dir.id)).toBe(true);
  }, 60_000);

  it("articles à risque : AUCUNE écriture sans confirmation ; la confirmation les compte et les nomme (stock, mouvements, prix, fiche, restaurant)", async () => {
    const libre = await art("Cannelle");
    const farine = await art("Farine", { quantite: 12, prix: 2.5 });
    await prisma.mouvementStock.createMany({ data: Array.from({ length: 4 }, () => ({ articleId: farine, type: "ENTREE" as const, quantite: 3, date: new Date("2026-09-01") })) });
    const sucre = await art("Sucre");
    const fiche = await prisma.ficheTechnique.create({ data: { nom: "Pâte", nbPortions: 4 } });
    await prisma.ingredientFiche.create({ data: { ficheId: fiche.id, articleId: sucre, unite: "g", quantite: 200 } });
    const lait = await art("Lait");
    const resto = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Lait entier", unite: "kg" } });
    await prisma.articleRestoStock.create({ data: { articleRestoId: resto.id, articleStockId: lait } });

    const r = await changerUniteEnMasse([libre, farine, sucre, lait], "g");
    expect(estConfirmation(r)).toBe(true);
    if (!estConfirmation(r)) return;
    const { apercu } = r;
    // Rien n'a été écrit : ni unité, ni journal.
    for (const id of [libre, farine, sucre, lait]) expect(await unite(id), id).toBe("kg");
    expect(await journal("unite (masse)")).toHaveLength(0);
    // Le libre n'est pas dans la confirmation ; les trois autres, nommés avec leurs chiffres.
    expect(apercu.aConfirmer.map((l) => l.designation)).toEqual(["Farine", "Lait", "Sucre"]);
    expect(apercu.resume).toContain("3 articles ont déjà du stock");
    expect(apercu.resume).toContain("rien n'est converti");
    const farineL = apercu.aConfirmer.find((l) => l.designation === "Farine")!;
    expect(farineL.raisons).toEqual(["stock 12 kg", "4 mouvements", "prix de référence 2,50 $"]);
    expect(apercu.aConfirmer.find((l) => l.designation === "Sucre")!.alertes.join(" ")).toContain("Fiches techniques « Pâte » : 1 ligne change de coût");
    expect(apercu.aConfirmer.find((l) => l.designation === "Lait")!.alertes.join(" ")).toMatch(/Rattaché à « Lait entier » \(Cuisine, compté en kg\).*le stock du restaurant change/);
  }, 60_000);

  it("confirmé : écrit, MAIS RIEN N'EST CONVERTI (stock, mouvements, prix, comptages du restaurant gardent les mêmes chiffres)", async () => {
    const farine = await art("Farine", { quantite: 12, prix: 2.5 });
    await prisma.mouvementStock.create({ data: { articleId: farine, type: "ENTREE", quantite: 12, date: new Date("2026-09-01") } });
    const resto = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Farine T55", unite: "kg", stockBaseJournalier: 4 } });
    await prisma.articleRestoStock.create({ data: { articleRestoId: resto.id, articleStockId: farine } });
    await prisma.comptageResto.create({ data: { articleRestoId: resto.id, date: new Date("2026-09-02"), quantite: 3 } });

    const premier = await changerUniteEnMasse([farine], "g");
    if (!estConfirmation(premier)) throw new Error("confirmation attendue");
    const r = await changerUniteEnMasse([farine], "g", premier.apercu.confirmes);
    expect(r).toMatchObject({ proposition: false });
    expect((r as { message: string }).message).toBe("Unité « g » appliquée à 1 article, dont 1 avec stock, historique ou rattachement : leurs quantités et prix sont restés les mêmes chiffres, rien n'a été converti.");

    const a = await prisma.articleStock.findUniqueOrThrow({ where: { id: farine }, include: { stock: true } });
    expect(a.unite).toBe("g");
    expect(a.stock!.quantite.toString()).toBe("12");
    expect(a.prixUnitaireUSD!.toString()).toBe("2.5");
    expect((await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: farine } })).quantite.toString()).toBe("12");
    // Le restaurant n'est PAS touché (l'alignement d'unité est un geste à part, confirmé) : mêmes chiffres, même unité.
    const r2 = await prisma.articleResto.findUniqueOrThrow({ where: { id: resto.id } });
    expect([r2.unite, r2.stockBaseJournalier!.toString()]).toEqual(["kg", "4"]);
    expect((await prisma.comptageResto.findFirstOrThrow({ where: { articleRestoId: resto.id } })).quantite.toString()).toBe("3");

    // Journal : l'ancienne et la nouvelle unité de l'article, et le résumé nomme ce qui a été confirmé.
    const [ligne] = (await journal("unite (masse)")).filter((l) => l.entiteId === farine);
    expect([ligne.ancienneValeur, ligne.nouvelleValeur]).toEqual(["kg", "g"]);
    expect((await journal("unite (masse)")).find((l) => l.entiteId === "1 articles")!.nouvelleValeur).toContain("Farine (kg → g)");
  }, 60_000);

  it("une confirmation qui ne couvre pas tous les articles à risque est refusée : le serveur redemande, rien n'est écrit", async () => {
    const farine = await art("Farine", { quantite: 12 }), sucre = await art("Sucre", { quantite: 3 });
    const r = await changerUniteEnMasse([farine, sucre], "g", [farine]); // l'écran n'avait confirmé que la farine
    expect(estConfirmation(r)).toBe(true);
    expect(await unite(farine)).toBe("kg");
    expect(await unite(sucre)).toBe("kg");
    // Et une confirmation ancienne (le sucre a gagné du stock depuis) ne s'étend pas d'elle-même.
    const libre = await art("Cannelle");
    expect(estConfirmation(await changerUniteEnMasse([libre], "g", []))).toBe(false); // libre : aucune confirmation requise
    expect(await unite(libre)).toBe("g");
  }, 60_000);

  it("article SANS unité : l'unité se pose, même avec du stock, sans confirmation", async () => {
    const a = await art("Poivre", { unite: null, quantite: 7 });
    expect(await changerUniteEnMasse([a], "kg")).toMatchObject({ proposition: false });
    expect(await unite(a)).toBe("kg");
    expect((await journal("unite (masse)")).find((l) => l.entiteId === a)).toMatchObject({ ancienneValeur: null, nouvelleValeur: "kg" });
  }, 60_000);

  it("même unité à l'orthographe près (Kg → kg) : écrit sans confirmation, même avec du stock ; déjà dans la bonne unité : « Rien à changer »", async () => {
    const a = await art("Riz", { unite: "Kg", quantite: 10 });
    expect(await changerUniteEnMasse([a], "kg")).toMatchObject({ message: "Unité « kg » appliquée à 1 article." });
    expect(await unite(a)).toBe("kg");
    expect(await changerUniteEnMasse([a], "kg")).toEqual({ proposition: false, message: "Rien à changer : cet article est déjà en « kg »." });
  }, 60_000);

  it("refus lisibles : unité vide ou trop longue, aucun article, article introuvable", async () => {
    const a = await art("Riz");
    expect(erreurDe(await changerUniteEnMasse([a], "  "))).toBe("Choisissez ou saisissez l'unité à appliquer.");
    expect(erreurDe(await changerUniteEnMasse([a], "x".repeat(41)))).toContain("trop longue");
    expect(erreurDe(await changerUniteEnMasse([], "g"))).toBe("Aucun article sélectionné.");
    expect(erreurDe(await changerUniteEnMasse([a, "00000000-0000-0000-0000-000000000000"], "g"))).toBe("Article introuvable : rechargez la page.");
    expect(await unite(a)).toBe("kg");
  }, 60_000);
});

describe("autre rôle : proposé, puis approuvé par la Direction", () => {
  it("le responsable stock PROPOSE : aucune unité ne change ; la Direction voit l'avertissement, approuve, et l'unité change", async () => {
    const farine = await art("Farine", { quantite: 12, prix: 2.5 }), cannelle = await art("Cannelle");
    en("resp");
    const r = await changerUniteEnMasse([farine, cannelle], "g");
    expect(r).toMatchObject({ proposition: true });
    expect((r as { message: string }).message).toContain("Proposition envoyée à la Direction : 2 articles ne changent qu'après sa validation.");
    expect((r as { message: string }).message).toContain("1 article a du stock, un historique ou un rattachement : la Direction le verra à l'approbation (rien n'est converti).");
    expect(await unite(farine)).toBe("kg");
    expect(await unite(cannelle)).toBe("kg");
    expect(await journal("unite (masse)")).toHaveLength(0); // rien d'écrit, donc rien de journalisé à ce stade

    const [d] = await prisma.demandeValidationStock.findMany({ where: { statut: "EN_ATTENTE" } });
    expect(d.nature).toBe("MODIF_ARTICLE");
    const charge = d.charge as { articles: { id: string; changements: { champ: string; avantLibelle: string; apresLibelle: string }[] }[] };
    expect(charge.articles.map((a) => a.changements.map((c) => `${c.champ}: ${c.avantLibelle} → ${c.apresLibelle}`))).toEqual([["unite: kg → g"], ["unite: kg → g"]]);

    // Ce que la Direction lit sur « À valider » : l'avertissement de la farine seule.
    const [apercu] = await apercusDemandes({ id: d.id }, { detail: true });
    const avert = Object.fromEntries(apercu.article!.articles.map((x) => [x.id, x.avertissements ?? null]));
    expect(avert[cannelle]).toBeNull();
    expect(avert[farine]!.join(" ")).toContain("kg → g : stock 12 kg, prix de référence 2,50 $ — quantités et prix gardent les mêmes chiffres dans la nouvelle unité, rien n'est converti.");

    en("dir");
    expect(apercu.version).toContain("#u:"); // le jeton de version porte l'empreinte des avertissements affichés
    expect(await validerDemandes([d.id], {}, { [d.id]: apercu.version })).toEqual({ traitees: [d.id], echecs: [] });
    expect(await unite(farine)).toBe("g");
    expect(await unite(cannelle)).toBe("g");
    expect((await prisma.stock.findUniqueOrThrow({ where: { articleId: farine } })).quantite.toString()).toBe("12"); // même chiffre
  }, 90_000);

  it("la proposition d'un autre compte déjà en attente sur l'article est refusée, nommée", async () => {
    const a = await art("Riz");
    en("resp");
    await changerUniteEnMasse([a], "g");
    A.user = { ...U.resp, id: (await prisma.user.create({ data: { email: "autre@pef.cd", nom: "Marie", role: "STOCK" } })).id, nom: "Marie" };
    expect(erreurDe(await changerUniteEnMasse([a], "L"))).toContain("a déjà une proposition en attente (Jean)");
  }, 60_000);
});
