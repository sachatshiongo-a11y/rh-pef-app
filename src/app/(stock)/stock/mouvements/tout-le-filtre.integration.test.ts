import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { whereMouvements, whereColonne, PLAFOND_AFFICHAGE, BORNE_TOUT_LE_FILTRE, type FiltreMouvements, type CleMotif } from "@/lib/filtre-mouvements";

// « Sélectionner tout le filtre » (décision du 2026-09-29). La veille, la Direction avait voulu
// requalifier toutes les sorties de septembre : l'écran n'en montrait que 600 mouvements, entrées
// comprises, et 26 sorties des 1er et 2 septembre sont restées sans motif, invisibles. Ici : l'action
// vise TOUT le filtre, recompté par le serveur avec le MÊME `where` que la page, et rien d'autre.
// Base éphémère, jamais la prod.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/alerte-stock", () => ({ niveauxActuels: async () => new Map(), notifierNouvellesAlertes: async () => {} }));

const { requalifierSorties, supprimerMouvementsEnLot } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let farine: string;
let sel: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "filtre@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

const jour = (j: number) => new Date(Date.UTC(2026, 8, j)); // septembre 2026
const ENTREES_SEPT = 650;

beforeEach(async () => {
  A.user.role = "ADMIN";
  await prisma.journalAudit.deleteMany();
  await prisma.clotureStock.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
  farine = (await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg" } })).id;
  sel = (await prisma.articleStock.create({ data: { designation: "Sel", domaine: "NOURRITURE", unite: "kg" } })).id;
  await prisma.stock.createMany({ data: [{ articleId: farine, quantite: "1000" }, { articleId: sel, quantite: "100" }] });
  await prisma.mouvementStock.createMany({ data: [
    // 650 entrées récentes (10 → 30 septembre) : elles remplissent l'écran.
    ...Array.from({ length: ENTREES_SEPT }, (_, i) => ({ articleId: farine, type: "ENTREE" as const, quantite: "1", date: jour(10 + (i % 21)), origine: "Liste d'achat" })),
    // 26 sorties sans motif des 1er et 2 septembre : hors de l'écran.
    ...Array.from({ length: 26 }, (_, i) => ({ articleId: farine, type: "SORTIE" as const, quantite: "2", date: jour(1 + (i % 2)), origine: "Import Excel" })),
    // 10 sorties sans motif récentes (Sel), 5 pertes, un ajustement.
    ...Array.from({ length: 10 }, () => ({ articleId: sel, type: "SORTIE" as const, quantite: "1", date: jour(20), origine: "Sortie / consommation" })),
    ...Array.from({ length: 5 }, () => ({ articleId: farine, type: "SORTIE" as const, quantite: "1", date: jour(15), categorieSortie: "PERTE", raisonSortie: "cassé", origine: "Perte — cassé" })),
    { articleId: farine, type: "AJUSTEMENT" as const, quantite: "3", date: jour(12), origine: "Inventaire" },
    // Août : 4 sorties sans motif, hors du filtre de septembre.
    ...Array.from({ length: 4 }, () => ({ articleId: farine, type: "SORTIE" as const, quantite: "1", date: new Date(Date.UTC(2026, 7, 20)), origine: "Import Excel" })),
  ] });
});

const SEPT_SANS: FiltreMouvements = { mois: "2026-9", articleId: null, motif: "sans" };
const SEPT: FiltreMouvements = { mois: "2026-9", articleId: null, motif: null };
const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error("Action acceptée alors qu'elle aurait dû être refusée.");
};
const instantane = () => prisma.mouvementStock.findMany({ orderBy: { id: "asc" } });
const stocks = async () => Object.fromEntries((await prisma.stock.findMany()).map((s) => [s.articleId, s.quantite.toString()]));

describe("le filtre partagé, évalué sur une vraie base : chaque combinaison", () => {
  it("mois × produit × motif × colonne : le `where` compte exactement ce que la règle métier désigne", async () => {
    const tous = await prisma.mouvementStock.findMany();
    const CAT: Record<CleMotif, string | null> = { livraison: "LIVRAISON_RESTAURANT", perte: "PERTE", sans: null };
    for (const mois of ["tous", "2026-9", "2026-8"]) for (const articleId of [null, farine, sel]) for (const motif of [null, "livraison", "perte", "sans"] as (CleMotif | null)[]) {
      const f: FiltreMouvements = { mois, articleId, motif };
      const garde = tous.filter((m) =>
        (mois === "tous" || `${m.date.getUTCFullYear()}-${m.date.getUTCMonth() + 1}` === mois)
        && (!articleId || m.articleId === articleId)
        && (!motif || (m.type === "SORTIE" && m.categorieSortie === CAT[motif])));
      expect(await prisma.mouvementStock.count({ where: whereMouvements(f) }), JSON.stringify(f)).toBe(garde.length);
      expect(await prisma.mouvementStock.count({ where: whereColonne(f, "SORTIES") }), JSON.stringify(f)).toBe(garde.filter((m) => m.type === "SORTIE").length);
      expect(await prisma.mouvementStock.count({ where: whereColonne(f, "ENTREES") }), JSON.stringify(f)).toBe(garde.filter((m) => m.type !== "SORTIE").length);
    }
  }, 120_000);
});

describe("changer le motif de TOUT le filtre", () => {
  it("requalifie toutes les sorties du filtre, les plus anciennes (hors écran) comprises, et rien d'autre", async () => {
    // L'écran, filtre « septembre » sans motif : les 26 sorties des 1er et 2 septembre n'y sont pas.
    const affiches = await prisma.mouvementStock.findMany({ where: whereMouvements(SEPT), orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: PLAFOND_AFFICHAGE });
    const anciennes = await prisma.mouvementStock.findMany({ where: { type: "SORTIE", date: { lt: jour(3) , gte: jour(1) } } });
    expect(anciennes).toHaveLength(26);
    expect(affiches.filter((m) => anciennes.some((a) => a.id === m.id))).toHaveLength(0);

    const avant = await instantane();
    const nb = await prisma.mouvementStock.count({ where: whereColonne(SEPT_SANS, "SORTIES") });
    expect(nb).toBe(36);
    expect(await requalifierSorties({ filtre: SEPT_SANS, colonne: "SORTIES", attendu: 36 }, "LIVRAISON_RESTAURANT")).toEqual({ n: 36 });

    const apres = await instantane();
    const change = apres.filter((m, i) => m.categorieSortie !== avant[i]!.categorieSortie);
    expect(change).toHaveLength(36);
    expect(change.every((m) => m.type === "SORTIE" && m.date >= jour(1) && m.date < jour(31))).toBe(true);
    expect(anciennes.every((a) => change.some((m) => m.id === a.id))).toBe(true); // les plus anciennes y sont
    // Rien d'autre : entrées, ajustement, pertes et sorties d'août intacts (motif, raison, libellé).
    for (const [i, m] of apres.entries()) {
      if (change.some((c) => c.id === m.id)) continue;
      expect([m.categorieSortie, m.raisonSortie, m.origine]).toEqual([avant[i]!.categorieSortie, avant[i]!.raisonSortie, avant[i]!.origine]);
    }
    // Libellés automatiques suivis, libellés importés conservés.
    expect(new Set(apres.filter((m) => m.articleId === sel).map((m) => m.origine))).toEqual(new Set(["Livraison restaurant"]));
    expect(anciennes.map((a) => apres.find((m) => m.id === a.id)!.origine).every((o) => o === "Import Excel")).toBe(true);
    // Journalisé mouvement par mouvement ; stock du dépôt inchangé.
    const journal = await prisma.journalAudit.findMany({ where: { entite: "MouvementStock", champ: "categorieSortie" } });
    expect(new Set(journal.map((j) => j.entiteId))).toEqual(new Set(change.map((m) => m.id)));
    expect(journal).toHaveLength(36);
    expect(await stocks()).toEqual({ [farine]: "1000", [sel]: "100" });
  }, 60_000);

  it("filtre par produit : seules les sorties de ce produit", async () => {
    const f: FiltreMouvements = { mois: "2026-9", articleId: sel, motif: null };
    expect(await requalifierSorties({ filtre: f, colonne: "SORTIES", attendu: 10 }, "PERTE", "périmé")).toEqual({ n: 10 });
    expect(await prisma.mouvementStock.count({ where: { raisonSortie: "périmé" } })).toBe(10);
    expect(await prisma.mouvementStock.count({ where: { raisonSortie: "périmé", articleId: { not: sel } } })).toBe(0);
  }, 60_000);

  it("le nombre a changé depuis l'affichage : rien n'est écrit, le nouveau nombre revient", async () => {
    const avant = await instantane();
    const r = await requalifierSorties({ filtre: SEPT_SANS, colonne: "SORTIES", attendu: 35 }, "LIVRAISON_RESTAURANT");
    expect(erreurDe(r)).toBe("Le filtre compte maintenant 36 sorties, et non 35 comme confirmé : rien n'a été modifié. Vérifiez, puis confirmez à nouveau.");
    expect((r as { nouveauNombre?: number }).nouveauNombre).toBe(36);
    expect(await instantane()).toEqual(avant);
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);

  it("période clôturée : refus lisible, rien n'est écrit", async () => {
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 9 } });
    const avant = await instantane();
    expect(erreurDe(await requalifierSorties({ filtre: SEPT_SANS, colonne: "SORTIES", attendu: 36 }, "LIVRAISON_RESTAURANT"))).toBe(
      "La période 09/2026 est clôturée : le motif de ses sorties ne peut plus être changé. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)",
    );
    expect(await instantane()).toEqual(avant);
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);

  it("compte non-Direction : refusé, rien n'est écrit ; la colonne Entrées n'a pas de motif", async () => {
    const avant = await instantane();
    A.user.role = "STOCK";
    expect(erreurDe(await requalifierSorties({ filtre: SEPT_SANS, colonne: "SORTIES", attendu: 36 }, "LIVRAISON_RESTAURANT"))).toMatch(/Accès refusé/);
    expect(erreurDe(await supprimerMouvementsEnLot({ filtre: SEPT, colonne: "ENTREES", attendu: ENTREES_SEPT + 1 }))).toMatch(/Accès refusé/);
    A.user.role = "ADMIN";
    expect(erreurDe(await requalifierSorties({ filtre: SEPT, colonne: "ENTREES", attendu: ENTREES_SEPT + 1 }, "PERTE", "x"))).toMatch(/Seules les sorties/);
    expect(await instantane()).toEqual(avant);
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);

  it(`borne : ${BORNE_TOUT_LE_FILTRE} passent, ${BORNE_TOUT_LE_FILTRE + 1} sont refusées avec une invitation à affiner`, async () => {
    const oct = { mois: "2026-10", articleId: null, motif: "sans" } as const satisfies FiltreMouvements;
    await prisma.mouvementStock.createMany({ data: Array.from({ length: BORNE_TOUT_LE_FILTRE + 1 }, (_, i) => ({ articleId: farine, type: "SORTIE" as const, quantite: "1", date: new Date(Date.UTC(2026, 9, 1 + (i % 28))), origine: "Import Excel" })) });
    const r = await requalifierSorties({ filtre: oct, colonne: "SORTIES", attendu: BORNE_TOUT_LE_FILTRE + 1 }, "LIVRAISON_RESTAURANT");
    expect(erreurDe(r)).toBe(`Le filtre compte ${BORNE_TOUT_LE_FILTRE + 1} sorties : au-delà de ${BORNE_TOUT_LE_FILTRE}, une action groupée est refusée. Affinez par mois, produit ou motif.`);
    expect(await prisma.mouvementStock.count({ where: { categorieSortie: "LIVRAISON_RESTAURANT" } })).toBe(0);
    expect(erreurDe(await supprimerMouvementsEnLot({ filtre: oct, colonne: "SORTIES", attendu: BORNE_TOUT_LE_FILTRE + 1 }))).toMatch(/au-delà de 5000/);
    expect(await prisma.mouvementStock.count({ where: { date: { gte: new Date(Date.UTC(2026, 9, 1)) } } })).toBe(BORNE_TOUT_LE_FILTRE + 1);

    const une = await prisma.mouvementStock.findFirstOrThrow({ where: { date: { gte: new Date(Date.UTC(2026, 9, 1)) } } });
    await prisma.mouvementStock.delete({ where: { id: une.id } });
    expect(await requalifierSorties({ filtre: oct, colonne: "SORTIES", attendu: BORNE_TOUT_LE_FILTRE }, "LIVRAISON_RESTAURANT")).toEqual({ n: BORNE_TOUT_LE_FILTRE });
    expect(await prisma.journalAudit.count()).toBe(BORNE_TOUT_LE_FILTRE);
  }, 120_000);
});

describe("supprimer TOUT le filtre d'une colonne", () => {
  it("colonne Entrées de septembre, produit Farine : toutes supprimées, stock annulé, journal par mouvement ; sorties intactes", async () => {
    const f: FiltreMouvements = { mois: "2026-9", articleId: farine, motif: null };
    const sortiesAvant = await prisma.mouvementStock.count({ where: { type: "SORTIE" } });
    expect(await supprimerMouvementsEnLot({ filtre: f, colonne: "ENTREES", attendu: ENTREES_SEPT + 1 })).toEqual({ n: ENTREES_SEPT + 1 });
    expect(await prisma.mouvementStock.count({ where: { type: { not: "SORTIE" } } })).toBe(0);
    expect(await prisma.mouvementStock.count({ where: { type: "SORTIE" } })).toBe(sortiesAvant);
    // 650 entrées de 1 kg retirées ; l'ajustement ne recalcule rien ; le sel n'est pas touché.
    expect(await stocks()).toEqual({ [farine]: "350", [sel]: "100" });
    expect(await prisma.journalAudit.count({ where: { entite: "MouvementStock", champ: "suppression" } })).toBe(ENTREES_SEPT + 1);
  }, 60_000);

  it("nombre changé, ou période clôturée : rien n'est supprimé", async () => {
    const avant = await instantane();
    const r = await supprimerMouvementsEnLot({ filtre: SEPT, colonne: "ENTREES", attendu: ENTREES_SEPT });
    expect(erreurDe(r)).toMatch(/compte maintenant 651 mouvements, et non 650/);
    expect((r as { nouveauNombre?: number }).nouveauNombre).toBe(ENTREES_SEPT + 1);
    await prisma.clotureStock.create({ data: { annee: 2026, mois: 9 } });
    expect(erreurDe(await supprimerMouvementsEnLot({ filtre: SEPT, colonne: "ENTREES", attendu: ENTREES_SEPT + 1 }))).toMatch(/09\/2026 est clôturée/);
    expect(await instantane()).toEqual(avant);
    expect(await stocks()).toEqual({ [farine]: "1000", [sel]: "100" });
    expect(await prisma.journalAudit.count()).toBe(0);
  }, 60_000);

  it("la sélection par id garde son comportement : effet sur le stock annulé, en décimal exact", async () => {
    const ids = (await prisma.mouvementStock.findMany({ where: { articleId: sel }, select: { id: true } })).map((m) => m.id);
    const e = await prisma.mouvementStock.create({ data: { articleId: sel, type: "ENTREE", quantite: "0.1", date: jour(25) } });
    const e2 = await prisma.mouvementStock.create({ data: { articleId: sel, type: "ENTREE", quantite: "0.2", date: jour(25) } });
    expect(await supprimerMouvementsEnLot([...ids, e.id, e2.id])).toEqual({ n: 12 });
    expect((await stocks())[sel]).toBe("109.7"); // 100 + 10 sorties rendues − 0,3 d'entrées
  }, 60_000);
});
