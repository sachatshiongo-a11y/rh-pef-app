import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";

/**
 * Saisie des VENTES (Conso. journalière → Ventes) sur une VRAIE base (Postgres éphémère) :
 * unicité (jour, ligne), case vide ≠ 0, période de stock clôturée en lecture seule, droits
 * identiques à la grille Commande (espace Stock), journal, et suppressions refusées d'une fiche ou
 * d'un article qui porte des ventes.
 */
const H = vi.hoisted(() => ({
  client: undefined as unknown as PrismaClient,
  user: { id: "", role: "STOCK" as Role, accesStock: false, nom: "Stock" },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
// Mêmes règles d'accès que la vraie `requireModule` (prédicats purs de lib/espaces).
vi.mock("@/lib/auth", () => ({
  verifySession: async () => H.user,
  requireModule: (u: { role: Role; accesStock?: boolean }, espace: string) => {
    if (espace !== "stock" || !estStock(u)) throw new Error("Accès refusé : module non autorisé.");
  },
  requireRole: (u: { role: Role }, roles: Role[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saisirVente } = await import("./ventes-actions");
const { chargerVentesSemaine } = await import("./ventes-data");
const { supprimerFiches } = await import("../fiches/actions");
const { supprimerArticleResto } = await import("../restaurant/actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ids = { stock: "", rh: "", salarieStock: "", carbo: "", sousRecette: "", mojito: "", inactif: "", coca: "", cuisineResto: "" };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = (email: string, role: Role, accesStock = false) => prisma.user.create({ data: { email, nom: email, role, accesStock } });
  ids.stock = (await u("stock@pef.test", "STOCK")).id;
  ids.rh = (await u("rh@pef.test", "MANAGER")).id;
  ids.salarieStock = (await u("salarie@pef.test", "EMPLOYE", true)).id;
  ids.carbo = (await prisma.ficheTechnique.create({ data: { nom: "Carbonara", categorie: "Pâtes classiques" } })).id;
  ids.sousRecette = (await prisma.ficheTechnique.create({ data: { nom: "Béchamel", categorie: "Pâtes classiques", estSousRecette: true } })).id;
  ids.mojito = (await prisma.ficheTechnique.create({ data: { nom: "Mojito", categorie: "Cocktail", type: "BAR" } })).id;
  ids.inactif = (await prisma.ficheTechnique.create({ data: { nom: "Lasagne végétarienne", categorie: "Pâtes classiques", actif: false } })).id;
  ids.coca = (await prisma.articleResto.create({ data: { espace: "BAR", categorie: "Limonade et autre", designation: "Coca Cola", ordre: 9 } })).id;
  ids.cuisineResto = (await prisma.articleResto.create({ data: { espace: "CUISINE", categorie: "Viande", designation: "Filet de boeuf", unite: "Kg", ordre: 1 } })).id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(async () => {
  H.user = { id: ids.stock, role: "STOCK", accesStock: false, nom: "Stock" };
  await prisma.venteJournaliere.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.clotureStock.deleteMany();
});

const lignesVentes = () => prisma.venteJournaliere.findMany({ orderBy: { createdAt: "asc" }, select: { date: true, ficheId: true, articleRestoId: true, quantite: true, saisiParId: true } });

describe("saisie des ventes", () => {
  it("une case vide n'est pas 0 : 12 → 0 (saisi, gardé) → vidé (ligne retirée), chaque changement journalisé", async () => {
    const plat = `fiche:${ids.carbo}`;
    expect(await saisirVente(plat, "2026-09-22", 12)).toEqual({ ok: true });
    expect(await lignesVentes()).toEqual([{ date: le("2026-09-22"), ficheId: ids.carbo, articleRestoId: null, quantite: 12, saisiParId: ids.stock }]);

    expect(await saisirVente(plat, "2026-09-22", 0)).toEqual({ ok: true });
    expect((await lignesVentes()).map((v) => v.quantite)).toEqual([0]); // 0 = « rien vendu », enregistré

    expect(await saisirVente(plat, "2026-09-22", null)).toEqual({ ok: true });
    expect(await lignesVentes()).toEqual([]); // case vidée = plus de saisie (« — »)

    const journal = await prisma.journalAudit.findMany({ orderBy: { date: "asc" }, select: { entite: true, entiteId: true, champ: true, ancienneValeur: true, nouvelleValeur: true, userId: true } });
    expect(journal).toEqual([
      { entite: "VenteJournaliere", entiteId: `${plat}_2026-09-22`, champ: "quantite", ancienneValeur: null, nouvelleValeur: "12", userId: ids.stock },
      { entite: "VenteJournaliere", entiteId: `${plat}_2026-09-22`, champ: "quantite", ancienneValeur: "12", nouvelleValeur: "0", userId: ids.stock },
      { entite: "VenteJournaliere", entiteId: `${plat}_2026-09-22`, champ: "quantite", ancienneValeur: "0", nouvelleValeur: null, userId: ids.stock },
    ]);
  });

  it("unicité (jour, ligne) : une seconde saisie remplace la première ; la base refuse un doublon", async () => {
    await saisirVente(`fiche:${ids.carbo}`, "2026-09-22", 3);
    await saisirVente(`fiche:${ids.carbo}`, "2026-09-22", 5);
    await saisirVente(`fiche:${ids.carbo}`, "2026-09-23", 7); // autre jour : autre ligne
    await saisirVente(`resto:${ids.coca}`, "2026-09-22", 24); // autre ligne, même jour
    expect((await lignesVentes()).map((v) => [v.date.toISOString().slice(0, 10), v.ficheId ?? v.articleRestoId, v.quantite])).toEqual([
      ["2026-09-22", ids.carbo, 5], ["2026-09-23", ids.carbo, 7], ["2026-09-22", ids.coca, 24],
    ]);
    await expect(prisma.venteJournaliere.create({ data: { date: le("2026-09-22"), ficheId: ids.carbo, quantite: 1 } })).rejects.toThrow();
    await expect(prisma.venteJournaliere.create({ data: { date: le("2026-09-22"), articleRestoId: ids.coca, quantite: 1 } })).rejects.toThrow();
  });

  it("même valeur ressaisie : ni écriture, ni journal", async () => {
    await saisirVente(`fiche:${ids.carbo}`, "2026-09-22", 4);
    await saisirVente(`fiche:${ids.carbo}`, "2026-09-22", 4);
    await saisirVente(`fiche:${ids.carbo}`, "2026-09-24", null); // vider une case déjà vide
    expect(await prisma.journalAudit.count()).toBe(1);
  });

  it("refus lisibles (retournés, jamais levés), rien d'écrit", async () => {
    const refus: [string, string, number | null, RegExp][] = [
      [`fiche:${ids.sousRecette}`, "2026-09-22", 1, /sous-recette ne se vend pas/],
      [`resto:${ids.cuisineResto}`, "2026-09-22", 1, /Seuls les articles du bar/],
      ["fiche:inconnue", "2026-09-22", 1, /Plat introuvable/],
      ["resto:inconnu", "2026-09-22", 1, /Boisson introuvable/],
      ["legume:Ail", "2026-09-22", 1, /Ligne de vente inconnue/],
      [`fiche:${ids.carbo}`, "2026-02-31", 1, /Date de vente invalide/],
      [`fiche:${ids.carbo}`, "22/09/2026", 1, /Date de vente invalide/],
      [`fiche:${ids.carbo}`, "2026-09-22", 2.5, /nombre entier/],
      [`fiche:${ids.carbo}`, "2026-09-22", -1, /Quantité vendue invalide/],
    ];
    for (const [ligne, jour, q, motif] of refus) {
      const r = await saisirVente(ligne, jour, q);
      expect(r, `${ligne} ${jour} ${q}`).toMatchObject({ erreur: expect.stringMatching(motif) });
    }
    expect(await lignesVentes()).toEqual([]);
    expect(await prisma.journalAudit.count()).toBe(0);
  });

  it("une fiche Bar (cocktail) et une fiche désactivée se vendent ; une boisson du bar aussi", async () => {
    expect(await saisirVente(`fiche:${ids.mojito}`, "2026-09-22", 6)).toEqual({ ok: true });
    expect(await saisirVente(`fiche:${ids.inactif}`, "2026-09-22", 1)).toEqual({ ok: true });
    expect(await saisirVente(`resto:${ids.coca}`, "2026-09-22", 0)).toEqual({ ok: true });
    expect(await prisma.venteJournaliere.count()).toBe(3);
  });
});

describe("période de stock clôturée", () => {
  it("un jour du mois clôturé ou d'un mois antérieur est en lecture seule ; le mois suivant reste ouvert", async () => {
    await saisirVente(`fiche:${ids.carbo}`, "2026-08-31", 3); // saisie avant clôture
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 8 } });
    for (const jour of ["2026-08-31", "2026-07-10"]) {
      expect(await saisirVente(`fiche:${ids.carbo}`, jour, 9)).toEqual({ erreur: expect.stringMatching(/La période 08\/2026 est clôturée : les ventes du .* sont en lecture seule/) });
    }
    expect(await saisirVente(`fiche:${ids.carbo}`, "2026-08-31", null)).toMatchObject({ erreur: expect.stringContaining("clôturée") }); // vider aussi
    expect((await lignesVentes()).map((v) => v.quantite)).toEqual([3]);
    expect(await saisirVente(`fiche:${ids.carbo}`, "2026-09-01", 2)).toEqual({ ok: true });

    // L'écran le sait jour par jour : semaine du 31/08 au 06/09, seul le lundi 31 est figé.
    const v = await chargerVentesSemaine(le("2026-08-31"), ["CUISINE"]);
    expect([...v.joursFiges]).toEqual(["2026-08-31"]);
  });
});

describe("droits : ceux de la grille Commande (espace Stock)", () => {
  it("un compte RH sans accès Stock est refusé, rien d'écrit ; un salarié ayant l'accès Stock saisit", async () => {
    H.user = { id: ids.rh, role: "MANAGER", accesStock: false, nom: "RH" };
    expect(await saisirVente(`fiche:${ids.carbo}`, "2026-09-22", 1)).toEqual({ erreur: "Accès refusé : module non autorisé." });
    expect(await lignesVentes()).toEqual([]);
    H.user = { id: ids.salarieStock, role: "EMPLOYE", accesStock: true, nom: "Salarié" };
    expect(await saisirVente(`fiche:${ids.carbo}`, "2026-09-22", 1)).toEqual({ ok: true });
    expect((await lignesVentes())[0]!.saisiParId).toBe(ids.salarieStock);
  });
});

describe("chargement de la semaine", () => {
  it("lignes par espace ; une fiche désactivée n'apparaît que si elle porte une vente ; sous-recettes jamais", async () => {
    let v = await chargerVentesSemaine(le("2026-09-21"), ["CUISINE", "BAR"]);
    expect(v.lignes.CUISINE.map((l) => l.designation)).toEqual(["Carbonara"]);
    expect(v.lignes.BAR.map((l) => l.designation)).toEqual(["Coca Cola", "Mojito"]);
    expect(v.jours).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);

    await saisirVente(`fiche:${ids.inactif}`, "2026-09-23", 2);
    await saisirVente(`resto:${ids.coca}`, "2026-09-27", 0);
    v = await chargerVentesSemaine(le("2026-09-21"), ["CUISINE"]);
    expect(v.lignes.CUISINE.map((l) => [l.designation, l.inactif])).toEqual([["Carbonara", false], ["Lasagne végétarienne", true]]);
    expect(v.lignes.BAR).toEqual([]); // espace non demandé
    expect(v.ventes.get(`fiche:${ids.inactif}_2026-09-23`)).toBe(2);
    expect(v.ventes.get(`resto:${ids.coca}_2026-09-27`)).toBe(0);
    expect(v.joursFiges.size).toBe(0);
  });
});

describe("suppressions : une fiche ou un article qui porte des ventes reste", () => {
  it("fiche technique vendue : suppression refusée en clair", async () => {
    H.user = { id: ids.stock, role: "ADMIN", accesStock: false, nom: "Direction" };
    await saisirVente(`fiche:${ids.mojito}`, "2026-09-22", 2);
    expect(await supprimerFiches([ids.mojito])).toEqual({ erreur: expect.stringContaining("« Mojito » a des ventes enregistrées") });
    expect(await prisma.ficheTechnique.count({ where: { id: ids.mojito } })).toBe(1);
  });

  it("article du bar vendu : suppression refusée en clair", async () => {
    H.user = { id: ids.stock, role: "ADMIN", accesStock: false, nom: "Direction" };
    await saisirVente(`resto:${ids.coca}`, "2026-09-22", 2);
    expect(await supprimerArticleResto(ids.coca)).toEqual({ erreur: expect.stringContaining("ventes enregistrées") });
    expect(await prisma.articleResto.count({ where: { id: ids.coca } })).toBe(1);
  });
});
