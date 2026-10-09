import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — demande de Sacha du 2026-10-09 : « dans
// l'inventaire on doit pouvoir créer ou modifier des catégories ». Les VRAIES actions serveur, appelées
// directement (comme le ferait un compte qui contourne l'écran) :
//  - création (nom + domaine), anti-doublon identique à celui des articles : casse, accents, espaces,
//    pluriel « Tomate »/« Tomates » ; le refus NOMME la catégorie existante (archivée comprise) ;
//  - renommage (même anti-doublon, sans se compter elle-même), ordre, archivage / réactivation ;
//  - une catégorie archivée n'est plus acceptée comme destination, ses articles y restent rattachés ;
//  - domaine : seulement si la catégorie est vide, et jamais celui d'un article ;
//  - suppression : Direction seulement, catégorie vide seulement, tout ou rien ;
//  - les autres rôles ne changent rien.
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

const CAT = await import("./actions");
const ART = await import("../actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const erreurDe = (r: unknown) => (r && typeof r === "object" && "erreur" in r ? String((r as { erreur: string }).erreur) : null);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const creer = (nom: string, domaine = "NOURRITURE") => CAT.creerCategorie(fd({ nom, domaine }));
const noms = async (domaine?: "NOURRITURE" | "BOISSON" | "AUTRE") =>
  (await prisma.categorieStock.findMany({ where: domaine ? { domaine } : {}, orderBy: [{ ordre: "asc" }, { nom: "asc" }] })).map((c) => c.nom);
const cat = (nom: string, domaine: "NOURRITURE" | "BOISSON" | "AUTRE" = "NOURRITURE", extra: { actif?: boolean; ordre?: number } = {}) =>
  prisma.categorieStock.create({ data: { nom, domaine, ...extra } });
const art = (designation: string, categorieId: string | null, domaine: "NOURRITURE" | "BOISSON" | "AUTRE" = "NOURRITURE", actif = true) =>
  prisma.articleStock.create({ data: { designation, domaine, categorieId, actif, stock: { create: { quantite: 5 } } } });

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
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  await prisma.categorieStock.deleteMany();
  await prisma.journalAudit.deleteMany();
});

describe("créer une catégorie", () => {
  it("nom + domaine ; espaces nettoyés ; placée à la fin de son domaine ; journalisée", async () => {
    expect(erreurDe(await creer("  Produits   laitiers "))).toBeNull();
    expect(erreurDe(await creer("Viandes"))).toBeNull();
    expect(erreurDe(await creer("Sodas", "BOISSON"))).toBeNull();
    const toutes = await prisma.categorieStock.findMany({ orderBy: [{ domaine: "asc" }, { ordre: "asc" }] });
    expect(toutes.map((c) => `${c.domaine}:${c.nom}:${c.ordre}:${c.actif}`)).toEqual(["NOURRITURE:Produits laitiers:1:true", "NOURRITURE:Viandes:2:true", "BOISSON:Sodas:1:true"]);
    const j = await prisma.journalAudit.findMany({ where: { entite: "CategorieStock", champ: "creation" } });
    expect(j).toHaveLength(3);
    expect(j.map((e) => e.nouvelleValeur)).toContain("Produits laitiers (Nourriture)");
  });

  it("refuse un nom vide ou un domaine inconnu", async () => {
    expect(erreurDe(await creer("   "))).toContain("requis");
    expect(erreurDe(await creer("Fruits", "AILLEURS"))).toContain("Domaine inconnu");
    expect(await noms()).toEqual([]);
  });

  it.each([
    ["Tomates", "même nom"],
    ["tomates", "casse"],
    ["  TOMATES  ", "espaces et casse"],
    ["Tomate", "singulier / pluriel"],
    ["Tomatés", "accent"],
  ])("refuse « %s » (%s) quand « Tomates » existe dans le même domaine — et nomme l'existante", async (saisi) => {
    await cat("Tomates");
    const msg = erreurDe(await creer(saisi));
    expect(msg).toContain("« Tomates »");
    expect(msg).toContain("Nourriture");
    expect(msg).toContain("Rien n'a été enregistré");
    expect(await noms()).toEqual(["Tomates"]);
  });

  it("refuse aussi l'ordre des mots (« Huile palme » / « Huile de palme ») et le pluriel simple « Choux »/« Chou »", async () => {
    await cat("Huile de palme");
    await cat("Choux");
    expect(erreurDe(await creer("Huile palme"))).toContain("« Huile de palme »");
    expect(erreurDe(await creer("Chou"))).toContain("« Choux »");
  });

  it("accepte le même nom dans un AUTRE domaine, et un nom vraiment différent", async () => {
    await cat("Jus", "BOISSON");
    expect(erreurDe(await creer("Jus", "NOURRITURE"))).toBeNull();
    expect(erreurDe(await creer("Viandes"))).toBeNull();
    expect(erreurDe(await creer("Poissons"))).toBeNull();
    expect((await noms("NOURRITURE")).sort()).toEqual(["Jus", "Poissons", "Viandes"]);
    // catégories sœurs : un mot partagé, un mot différent — légitimes
    expect(erreurDe(await creer("Boissons chaudes", "BOISSON"))).toBeNull();
    expect(erreurDe(await creer("Boissons froides", "BOISSON"))).toBeNull();
  });

  it("une catégorie ARCHIVÉE compte : le refus dit de la réactiver", async () => {
    await cat("Surgelés", "NOURRITURE", { actif: false });
    const msg = erreurDe(await creer("surgeles"));
    expect(msg).toContain("« Surgelés »");
    expect(msg).toContain("archivée");
    expect(msg).toContain("réactivez");
  });

  it("deux créations simultanées du même nom : une seule passe", async () => {
    const [a, b] = await Promise.all([creer("Épices"), creer("Epices")]);
    expect([erreurDe(a), erreurDe(b)].filter(Boolean)).toHaveLength(1);
    expect(await noms()).toHaveLength(1);
  });
});

describe("renommer", () => {
  it("renomme, journalise avant → après ; la casse seule d'elle-même est permise", async () => {
    const c = await cat("boissons chaudes", "BOISSON");
    expect(erreurDe(await CAT.modifierCategorie(c.id, fd({ nom: "Boissons chaudes" })))).toBeNull();
    expect((await prisma.categorieStock.findUniqueOrThrow({ where: { id: c.id } })).nom).toBe("Boissons chaudes");
    const j = await prisma.journalAudit.findFirstOrThrow({ where: { entite: "CategorieStock", champ: "nom" } });
    expect([j.ancienneValeur, j.nouvelleValeur]).toEqual(["boissons chaudes", "Boissons chaudes"]);
  });

  it("refuse un nom identique ou proche d'une AUTRE catégorie du domaine (pluriel compris), en la nommant", async () => {
    await cat("Tomates");
    const c = await cat("Légumes");
    const msg = erreurDe(await CAT.modifierCategorie(c.id, fd({ nom: "Tomate" })));
    expect(msg).toContain("« Tomates »");
    expect((await prisma.categorieStock.findUniqueOrThrow({ where: { id: c.id } })).nom).toBe("Légumes");
  });

  it("ne touche ni aux articles ni à leur domaine", async () => {
    const c = await cat("Farines");
    const a = await art("Farine T55", c.id);
    await CAT.modifierCategorie(c.id, fd({ nom: "Farines et amidons" }));
    const apres = await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } });
    expect([apres.categorieId, apres.domaine]).toEqual([c.id, "NOURRITURE"]);
  });
});

describe("changer le domaine d'une catégorie", () => {
  it("refusé tant qu'elle a des articles (même inactifs) : « déplacez d'abord » ; articles et catégorie inchangés", async () => {
    const c = await cat("Jus");
    const a = await art("Jus d'orange", c.id, "NOURRITURE", false); // archivé : il compte quand même
    const msg = erreurDe(await CAT.modifierCategorie(c.id, fd({ nom: "Jus", domaine: "BOISSON" })));
    expect(msg).toContain("déplacez d'abord");
    expect(msg).toContain("1 article");
    expect((await prisma.categorieStock.findUniqueOrThrow({ where: { id: c.id } })).domaine).toBe("NOURRITURE");
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } })).domaine).toBe("NOURRITURE");
  });

  it("accepté quand elle est vide, avec l'anti-doublon du NOUVEAU domaine", async () => {
    await cat("Jus", "BOISSON");
    const c = await cat("Jus");
    expect(erreurDe(await CAT.modifierCategorie(c.id, fd({ nom: "Jus", domaine: "BOISSON" })))).toContain("« Jus » (Boissons)");
    const d = await cat("Sirops");
    expect(erreurDe(await CAT.modifierCategorie(d.id, fd({ nom: "Sirops", domaine: "BOISSON" })))).toBeNull();
    expect((await prisma.categorieStock.findUniqueOrThrow({ where: { id: d.id } })).domaine).toBe("BOISSON");
  });
});

describe("archiver et réactiver", () => {
  it("archivée : ses articles restent rattachés et visibles ; plus acceptée comme destination", async () => {
    const vieille = await cat("Anciennes");
    const neuve = await cat("Nouvelles");
    const a = await art("Article d'hier", vieille.id);
    const b = await art("Article libre", null);
    expect(erreurDe(await CAT.basculerActifCategories([vieille.id], false))).toBeNull();
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } })).categorieId).toBe(vieille.id);

    // création d'article, catégoriser en masse, fiche article : refus lisible, rien ne bouge
    const f = fd({ designation: "Article neuf", domaine: "NOURRITURE", categorieId: vieille.id });
    expect(erreurDe(await ART.creerArticle(f))).toContain("archivée");
    expect(await prisma.articleStock.count({ where: { designation: "Article neuf" } })).toBe(0);
    expect(erreurDe(await ART.categoriserEnMasse([b.id], vieille.id))).toContain("archivée");
    expect(erreurDe(await ART.modifierArticle(b.id, fd({ categorieId: vieille.id })))).toContain("archivée");
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: b.id } })).categorieId).toBeNull();

    // l'article qui la porte déjà peut la garder (retouche sans rapport), et les actives restent permises
    expect(erreurDe(await ART.modifierArticle(a.id, fd({ categorieId: vieille.id, unite: "kg" })))).toBeNull();
    expect(erreurDe(await ART.categoriserEnMasse([b.id], neuve.id))).toBeNull();
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: b.id } })).categorieId).toBe(neuve.id);

    // réactivée : de nouveau proposée
    expect(erreurDe(await CAT.basculerActifCategories([vieille.id], true))).toBeNull();
    expect(erreurDe(await ART.categoriserEnMasse([b.id], vieille.id))).toBeNull();
  });

  it("en lot : plusieurs catégories d'un coup, journalisé une fois chacune", async () => {
    const a = await cat("A1"); const b = await cat("B2"); const c = await cat("C3");
    expect(erreurDe(await CAT.basculerActifCategories([a.id, b.id], false))).toBeNull();
    expect((await prisma.categorieStock.findMany({ where: { actif: false } })).map((x) => x.nom).sort()).toEqual(["A1", "B2"]);
    expect((await prisma.categorieStock.findUniqueOrThrow({ where: { id: c.id } })).actif).toBe(true);
    expect(await prisma.journalAudit.count({ where: { entite: "CategorieStock", champ: "actif" } })).toBe(2);
  });

  it("changer le domaine d'articles en masse ne reprend pas une catégorie archivée du même nom", async () => {
    const src = await cat("Jus", "NOURRITURE");
    await cat("Jus", "BOISSON", { actif: false });
    const a = await art("Jus d'ananas", src.id);
    const r = await ART.changerDomaineEnMasse([a.id], "BOISSON");
    expect(erreurDe(r)).toBeNull();
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } })).categorieId).toBeNull(); // « à classer »
  });
});

describe("ordre", () => {
  it("monter / descendre renumérote le domaine (tout à 0 au départ) puis échange les voisines", async () => {
    const a = await cat("Alpha"); const b = await cat("Bravo"); const c = await cat("Charlie");
    await cat("Zèbre", "BOISSON");
    expect(await noms("NOURRITURE")).toEqual(["Alpha", "Bravo", "Charlie"]); // ordre égal → par nom
    expect(erreurDe(await CAT.deplacerCategorie(c.id, "haut"))).toBeNull();
    expect(await noms("NOURRITURE")).toEqual(["Alpha", "Charlie", "Bravo"]);
    expect(erreurDe(await CAT.deplacerCategorie(a.id, "bas"))).toBeNull();
    expect(await noms("NOURRITURE")).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(erreurDe(await CAT.deplacerCategorie(b.id, "bas"))).toBeNull(); // déjà dernière : sans effet
    expect(await noms("NOURRITURE")).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect((await prisma.categorieStock.findMany({ where: { domaine: "BOISSON" } })).map((x) => x.ordre)).toEqual([0]); // l'autre domaine n'est pas touché
  });
});

describe("supprimer", () => {
  it("Direction : une catégorie vide disparaît, journalisée", async () => {
    const c = await cat("Vide");
    expect(erreurDe(await CAT.supprimerCategories([c.id]))).toBeNull();
    expect(await prisma.categorieStock.count()).toBe(0);
    expect(await prisma.journalAudit.count({ where: { entite: "CategorieStock", champ: "suppression" } })).toBe(1);
  });

  it("refusée si un article y est rattaché (même inactif) : tout ou rien, la catégorie et l'article restent", async () => {
    const pleine = await cat("Pleine");
    const vide = await cat("Vide");
    const a = await art("Article rangé", pleine.id, "NOURRITURE", false);
    const msg = erreurDe(await CAT.supprimerCategories([vide.id, pleine.id]));
    expect(msg).toContain("« Pleine » (1 article)");
    expect(msg).toContain("Rien n'a été supprimé");
    expect(await prisma.categorieStock.count()).toBe(2);
    expect((await prisma.articleStock.findUniqueOrThrow({ where: { id: a.id } })).categorieId).toBe(pleine.id);
  });

  it("refusée aux comptes qui ne sont pas la Direction, même pour une catégorie vide", async () => {
    const c = await cat("Vide");
    en("resp");
    expect(erreurDe(await CAT.supprimerCategories([c.id]))).toContain("réservé à la Direction");
    expect(await prisma.categorieStock.count()).toBe(1);
  });
});

describe("les autres rôles ne modifient rien", () => {
  it("créer, renommer, archiver, déplacer : refusés, rien n'est écrit", async () => {
    const c = await cat("Existante");
    en("resp");
    for (const r of [
      await creer("Nouvelle"),
      await CAT.modifierCategorie(c.id, fd({ nom: "Renommée" })),
      await CAT.basculerActifCategories([c.id], false),
      await CAT.deplacerCategorie(c.id, "bas"),
    ]) expect(erreurDe(r)).toContain("réservé à la Direction");
    const apres = await prisma.categorieStock.findMany();
    expect(apres.map((x) => `${x.nom}:${x.actif}:${x.ordre}`)).toEqual(["Existante:true:0"]);
    expect(await prisma.journalAudit.count({ where: { entite: "CategorieStock" } })).toBe(0);
  });
});
