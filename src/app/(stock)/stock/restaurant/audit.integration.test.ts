import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";

/**
 * Audit RESTAURANT du 10/10/2026, sur une VRAIE base (Postgres éphémère) :
 *  1. l'unité d'un article ne change plus dès qu'un comptage ou une livraison existe (4,5 kg ne
 *     devient pas 4,5 g) ; tout changement accepté est journalisé ;
 *  2. comptages et commandes : période clôturée en lecture seule, journal avant → après, auteur et
 *     horodatage de la dernière saisie ;
 *  6. une fiche vendue ne devient pas sous-recette et ne change pas d'espace ;
 *  12. la TVA vide n'est pas « 0 % ».
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

const { majComptage, modifierArticleResto } = await import("./actions");
const { saisirCommandeResto, saisirCommandeLegume } = await import("../journalier/actions");
const { modifierFiche } = await import("../fiches/actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids: Record<string, string> = {};
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error(`Action acceptée alors qu'elle aurait dû être refusée : ${JSON.stringify(r)}`);
};
const ok = (r: unknown) => { if (typeof r === "object" && r !== null && "erreur" in r) throw new Error(String((r as { erreur: string }).erreur)); };
const journal = (entite: string) => prisma.journalAudit.findMany({ where: { entite }, orderBy: { date: "asc" }, select: { entiteId: true, champ: true, ancienneValeur: true, nouvelleValeur: true, userId: true } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  ids.dir = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.stock = (await prisma.user.create({ data: { email: "stock@pef.test", nom: "Stock", role: "STOCK" } })).id;
  ids.sonde = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Sonde", unite: "kg", ordre: 1 } })).id;
  ids.vide = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Sans historique", unite: "kg", ordre: 2 } })).id;
  ids.sansUnite = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Sans unité", unite: null, ordre: 3 } })).id;
  const farine = await prisma.articleStock.create({ data: { designation: "Farine T45", domaine: "NOURRITURE", unite: "kg" } });
  ids.farine = farine.id;
  ids.livre = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Farine livrée", unite: "g", ordre: 4, liens: { create: { articleStockId: farine.id } } } })).id;
  ids.catCmd = (await prisma.articleStock.create({ data: { designation: "Riz", domaine: "NOURRITURE", unite: "kg" } })).id;
  ids.plat = (await prisma.ficheTechnique.create({ data: { nom: "Pâtes", type: "PLAT" } })).id;
  ids.platSansVente = (await prisma.ficheTechnique.create({ data: { nom: "Salade", type: "PLAT" } })).id;
  await prisma.venteJournaliere.create({ data: { date: le("2026-10-05"), ficheId: ids.plat, quantite: 3 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

beforeEach(() => { H.user = { id: ids.dir!, role: "ADMIN", accesStock: false, nom: "Direction" }; });

describe("2. comptages du restaurant : période figée, journal avant → après, auteur et horodatage", () => {
  it("un comptage est écrit avec son auteur et son heure, et journalisé ; un second le corrige, journal à l'appui", async () => {
    ok(await majComptage(ids.sonde!, "2026-10-05", "4,5"));
    const c1 = await prisma.comptageResto.findFirstOrThrow({ where: { articleRestoId: ids.sonde, date: le("2026-10-05") } });
    expect([c1.quantite.toString(), c1.saisiParId]).toEqual(["4.5", ids.dir]);
    expect(c1.saisiLe).not.toBeNull();

    H.user = { id: ids.stock!, role: "STOCK", accesStock: false, nom: "Stock" };
    ok(await majComptage(ids.sonde!, "2026-10-05", "5"));
    const c2 = await prisma.comptageResto.findFirstOrThrow({ where: { articleRestoId: ids.sonde, date: le("2026-10-05") } });
    expect([c2.quantite.toString(), c2.saisiParId]).toEqual(["5", ids.stock]);
    expect(c2.saisiLe!.getTime()).toBeGreaterThanOrEqual(c1.saisiLe!.getTime());

    expect(await journal("ComptageResto")).toEqual([
      { entiteId: `${ids.sonde}_2026-10-05`, champ: "quantite", ancienneValeur: null, nouvelleValeur: "4.5", userId: ids.dir },
      { entiteId: `${ids.sonde}_2026-10-05`, champ: "quantite", ancienneValeur: "4.5", nouvelleValeur: "5", userId: ids.stock },
    ]);
  });

  it("la même valeur ressaisie ne change ni la ligne, ni l'auteur, ni le journal ; vider la case est journalisé", async () => {
    const avant = await prisma.comptageResto.findFirstOrThrow({ where: { articleRestoId: ids.sonde, date: le("2026-10-05") } });
    H.user = { id: ids.dir!, role: "ADMIN", accesStock: false, nom: "Direction" };
    ok(await majComptage(ids.sonde!, "2026-10-05", "5"));
    const apres = await prisma.comptageResto.findFirstOrThrow({ where: { articleRestoId: ids.sonde, date: le("2026-10-05") } });
    expect([apres.saisiParId, apres.saisiLe!.getTime()]).toEqual([avant.saisiParId, avant.saisiLe!.getTime()]);
    expect(await prisma.journalAudit.count({ where: { entite: "ComptageResto" } })).toBe(2);

    ok(await majComptage(ids.sonde!, "2026-10-05", ""));
    expect(await prisma.comptageResto.count({ where: { articleRestoId: ids.sonde, date: le("2026-10-05") } })).toBe(0);
    const j = await journal("ComptageResto");
    expect(j.at(-1)).toEqual({ entiteId: `${ids.sonde}_2026-10-05`, champ: "quantite", ancienneValeur: "5", nouvelleValeur: null, userId: ids.dir });
    // Vider une case déjà vide : idempotent, sans journal.
    ok(await majComptage(ids.sonde!, "2026-10-05", ""));
    expect(await prisma.journalAudit.count({ where: { entite: "ComptageResto" } })).toBe(3);
  });

  it("une date illisible est refusée ; une période de stock CLÔTURÉE est en lecture seule (rien n'est écrit)", async () => {
    expect(erreurDe(await majComptage(ids.sonde!, "05/10/2026", "1"))).toBe("Date de comptage invalide.");
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 9 } });
    const avant = await prisma.journalAudit.count();
    expect(erreurDe(await majComptage(ids.sonde!, "2026-09-15", "7"))).toContain("La période 09/2026 est clôturée : les comptages du 15/09/2026 sont en lecture seule");
    expect(await prisma.comptageResto.count({ where: { date: le("2026-09-15") } })).toBe(0);
    expect(await prisma.journalAudit.count()).toBe(avant);
    ok(await majComptage(ids.sonde!, "2026-10-06", "7")); // après le mois clos : permis
    await prisma.clotureStock.deleteMany();
  });
});

describe("2. commandes journalières : période figée, journal, auteur", () => {
  it("une commande est journalisée (avant → après), signée, et la même quantité ne change rien", async () => {
    ok(await saisirCommandeResto(ids.catCmd!, "2026-10-05", 4));
    ok(await saisirCommandeResto(ids.catCmd!, "2026-10-05", 6));
    ok(await saisirCommandeResto(ids.catCmd!, "2026-10-05", 6));
    const c = await prisma.commandeResto.findFirstOrThrow({ where: { articleId: ids.catCmd } });
    expect([c.quantite.toString(), c.saisiParId]).toEqual(["6", ids.dir]);
    expect(await journal("CommandeResto")).toEqual([
      { entiteId: `${ids.catCmd}_2026-10-05`, champ: "quantite", ancienneValeur: null, nouvelleValeur: "4", userId: ids.dir },
      { entiteId: `${ids.catCmd}_2026-10-05`, champ: "quantite", ancienneValeur: "4", nouvelleValeur: "6", userId: ids.dir },
    ]);
    ok(await saisirCommandeResto(ids.catCmd!, "2026-10-05", 0)); // case vidée : la ligne part, le journal le dit
    expect(await prisma.commandeResto.count()).toBe(0);
    expect((await journal("CommandeResto")).at(-1)).toMatchObject({ ancienneValeur: "6", nouvelleValeur: null });
  });

  it("légumes : mêmes garanties ; mois clôturé refusé", async () => {
    ok(await saisirCommandeLegume("Ail", "2026-10-05", 2.5));
    expect((await prisma.commandeLegumeResto.findFirstOrThrow()).saisiParId).toBe(ids.dir);
    expect(await journal("CommandeLegumeResto")).toEqual([{ entiteId: "Ail_2026-10-05", champ: "quantite", ancienneValeur: null, nouvelleValeur: "2.5", userId: ids.dir }]);
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 10 } });
    expect(erreurDe(await saisirCommandeLegume("Ail", "2026-10-05", 9))).toContain("clôturée");
    expect(erreurDe(await saisirCommandeResto(ids.catCmd!, "2026-10-06", 9))).toContain("les commandes du 06/10/2026 sont en lecture seule");
    expect((await prisma.commandeLegumeResto.findFirstOrThrow()).quantite.toString()).toBe("2.5");
    await prisma.clotureStock.deleteMany();
  });
});

describe("1. l'unité d'un article du restaurant est celle de tout son historique", () => {
  it("un comptage existe : changer « kg » en « g » est refusé, avec le chemin à suivre ; rien ne change", async () => {
    ok(await majComptage(ids.sonde!, "2026-10-07", "4,5"));
    const e = erreurDe(await modifierArticleResto(ids.sonde!, fd({ unite: "g" })));
    expect(e).toContain("L'unité de « Sonde » ne peut plus changer");
    expect(e).toContain("2 comptage(s) existent déjà en « kg »"); // 06/10 et 07/10
    expect(e).toContain("par exemple, 4,5 kg deviendrait 4,5 g");
    expect(e).toContain("Créez un nouvel article");
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: ids.sonde } })).unite).toBe("kg");
    expect((await prisma.comptageResto.findFirstOrThrow({ where: { articleRestoId: ids.sonde, date: le("2026-10-07") } })).quantite.toString()).toBe("4.5");
  });

  it("une livraison du dépôt existe (sans comptage) : refusé aussi, et la livraison est nommée", async () => {
    await prisma.mouvementStock.create({ data: { articleId: ids.farine!, type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", quantite: 2, date: le("2026-10-05") } });
    const e = erreurDe(await modifierArticleResto(ids.livre!, fd({ unite: "kg" })));
    expect(e).toContain("1 livraison(s) du dépôt");
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: ids.livre } })).unite).toBe("g");
  });

  it("sans historique l'unité change, et le changement est journalisé (avant → après)", async () => {
    ok(await modifierArticleResto(ids.vide!, fd({ unite: "g" })));
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: ids.vide } })).unite).toBe("g");
    expect(await journal("ArticleResto")).toEqual([{ entiteId: ids.vide, champ: "unite", ancienneValeur: "kg", nouvelleValeur: "g", userId: ids.dir }]);
  });

  it("une unité jamais renseignée peut être posée (rien n'est réinterprété), journalisée ; le reste de la fiche reste modifiable malgré l'historique", async () => {
    await prisma.comptageResto.create({ data: { articleRestoId: ids.sansUnite!, date: le("2026-10-05"), quantite: 3 } });
    ok(await modifierArticleResto(ids.sansUnite!, fd({ unite: "casier" })));
    expect((await journal("ArticleResto")).at(-1)).toEqual({ entiteId: ids.sansUnite, champ: "unite", ancienneValeur: null, nouvelleValeur: "casier", userId: ids.dir });
    // Même unité renvoyée telle quelle (le formulaire la renvoie) + autre champ : accepté, rien de plus journalisé.
    const n = await prisma.journalAudit.count({ where: { entite: "ArticleResto" } });
    ok(await modifierArticleResto(ids.sonde!, fd({ unite: "kg", designation: "Sonde renommée" })));
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: ids.sonde } })).designation).toBe("Sonde renommée");
    expect(await prisma.journalAudit.count({ where: { entite: "ArticleResto" } })).toBe(n);
  });
});

describe("1 bis. corriger l'orthographe d'une unité reste permis malgré l'historique", () => {
  it("« casier » → « Casier » (même unité) est accepté et journalisé ; « casier » → « bac » reste refusé", async () => {
    // ids.sansUnite porte un comptage et l'unité « casier » (posée au test précédent).
    ok(await modifierArticleResto(ids.sansUnite!, fd({ unite: "Casier" })));
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: ids.sansUnite } })).unite).toBe("Casier");
    expect((await journal("ArticleResto")).at(-1)).toMatchObject({ entiteId: ids.sansUnite, ancienneValeur: "casier", nouvelleValeur: "Casier" });
    expect(erreurDe(await modifierArticleResto(ids.sansUnite!, fd({ unite: "bac" })))).toContain("ne peut plus changer");
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: ids.sansUnite } })).unite).toBe("Casier");
  });
});

describe("6. une fiche qui porte des ventes ne bascule pas", () => {
  const base = (extra: Record<string, string> = {}) => fd({ nom: "Pâtes", nbPortions: "1", tauxTVA: "0,16", actif: "on", ...extra });

  it("refus de la bascule en sous-recette : message qui nomme la fiche, les ventes et le chemin", async () => {
    const e = erreurDe(await modifierFiche(ids.plat!, base({ estSousRecette: "on" })));
    expect(e).toContain("« Pâtes » ne peut pas devenir une sous-recette");
    expect(e).toContain("1 vente(s)");
    expect(e).toContain("Désactivez-la");
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: ids.plat } })).estSousRecette).toBe(false);
  });

  it("refus du changement PLAT → BAR (ses ventes changeraient de feuille)", async () => {
    const e = erreurDe(await modifierFiche(ids.plat!, base({ type: "BAR" })));
    expect(e).toContain("passer de Plat à Bar");
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: ids.plat } })).type).toBe("PLAT");
  });

  it("sans vente, les deux sont permis ; une fiche vendue reste modifiable pour le reste", async () => {
    ok(await modifierFiche(ids.plat!, base({ nom: "Pâtes fraîches", type: "PLAT" })));
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: ids.plat } })).nom).toBe("Pâtes fraîches");
    ok(await modifierFiche(ids.platSansVente!, fd({ nom: "Salade", nbPortions: "1", tauxTVA: "0,16", actif: "on", type: "BAR" })));
    ok(await modifierFiche(ids.platSansVente!, fd({ nom: "Salade", nbPortions: "1", tauxTVA: "0,16", actif: "on", estSousRecette: "on" })));
    expect((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: ids.platSansVente } })).estSousRecette).toBe(true);
  });
});

describe("12. la TVA d'une fiche : case vide = refus, jamais 0 % silencieux", () => {
  it("vide ou blanche : refusée avec le chemin ; « 0 » est accepté (fiche non soumise)", async () => {
    const sans = (tva?: string) => fd({ nom: "Salade", nbPortions: "1", actif: "on", ...(tva === undefined ? {} : { tauxTVA: tva }) });
    expect(erreurDe(await modifierFiche(ids.platSansVente!, sans()))).toContain("La TVA est vide");
    expect(erreurDe(await modifierFiche(ids.platSansVente!, sans("  ")))).toContain("saisissez 0 si la fiche n'est pas soumise");
    await prisma.ficheTechnique.update({ where: { id: ids.platSansVente }, data: { tauxTVA: 0.16 } });
    expect(erreurDe(await modifierFiche(ids.platSansVente!, sans("")))).toContain("TVA est vide");
    expect(Number((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: ids.platSansVente } })).tauxTVA)).toBe(0.16); // pas écrasée par 0
    ok(await modifierFiche(ids.platSansVente!, sans("0")));
    expect(Number((await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: ids.platSansVente } })).tauxTVA)).toBe(0);
  });
});
