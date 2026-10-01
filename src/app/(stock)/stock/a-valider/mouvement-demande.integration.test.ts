import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : entrées/sorties manuelles soumises à la
// Direction (décision du 2026-10-01). « Livraison restaurant », « Perte » et « Retour restaurant »
// restent libres ; tout autre mouvement manuel d'un compte non-Direction devient une demande.
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
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { mouvementManuel } = await import("../mouvements/actions");
const { validerDemandes, refuserDemandes } = await import("./actions");

/** Version actuelle des demandes (jeton que l'écran renvoie avec la décision). */
const v = async (ids: string[]) => Object.fromEntries((await prisma.demandeValidationStock.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })).map((x) => [x.id, x.updatedAt.toISOString()]));

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"]] as const) {
    const u = await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } });
    U[k].id = u.id;
  }
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const article = async (designation: string, quantite = 10) => {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "Kg", prixUnitaireUSD: 2 } });
  await prisma.stock.create({ data: { articleId: a.id, quantite, stockMinimum: 1 } });
  return a.id;
};
const DATE = "2026-09-29";
const mvt = (o: { type: "ENTREE" | "SORTIE"; lignes: [string, number][]; categorieSortie?: string; raisonSortie?: string; motifEntree?: string; origine?: string }) => {
  const f = new FormData();
  f.set("type", o.type); f.set("date", DATE);
  if (o.categorieSortie) f.set("categorieSortie", o.categorieSortie);
  if (o.raisonSortie) f.set("raisonSortie", o.raisonSortie);
  if (o.motifEntree) f.set("motifEntree", o.motifEntree);
  if (o.origine) f.set("origine", o.origine);
  for (const [id, q] of o.lignes) { f.append("articleId", id); f.append("quantite", String(q)); }
  return f;
};
const stock = async (id: string) => Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: id } })).quantite);
const demandes = () => prisma.demandeValidationStock.findMany({ include: { cibles: true }, orderBy: { createdAt: "asc" } });
/** Ce qu'un mouvement a écrit sur un article (sans identifiants ni horodatage). */
const ecrit = async (id: string) => ({
  stock: await stock(id),
  mouvements: (await prisma.mouvementStock.findMany({ where: { articleId: id } })).map((m) => ({ type: m.type, quantite: m.quantite.toString(), origine: m.origine, date: m.date.toISOString(), categorieSortie: m.categorieSortie, raisonSortie: m.raisonSortie })),
});

describe("Flux libres : aucune validation, quel que soit le compte", () => {
  it.each([
    ["livraison restaurant", { type: "SORTIE" as const, categorieSortie: "LIVRAISON_RESTAURANT" }, 7],
    ["perte (raison)", { type: "SORTIE" as const, categorieSortie: "PERTE", raisonSortie: "Moisi" }, 7],
    ["retour restaurant", { type: "ENTREE" as const, motifEntree: "RETOUR_RESTAURANT" }, 13],
  ])("%s : écrit tout de suite", async (_n, o, attendu) => {
    const riz = await article("Riz");
    en("resp");
    expect(await mouvementManuel(mvt({ ...o, lignes: [[riz, 3]] }))).toMatchObject({ demande: false });
    expect(await stock(riz)).toBe(attendu);
    expect(await demandes()).toEqual([]);
  }, 60_000);
});

describe("Autre mouvement manuel du responsable : une demande, rien d'écrit", () => {
  it.each([
    ["sortie sans motif (inventaire, correction…)", { type: "SORTIE" as const, origine: "Inventaire" }],
    ["entrée hors retour restaurant (correction)", { type: "ENTREE" as const, origine: "Correction" }],
  ])("%s", async (_n, o) => {
    const riz = await article("Riz");
    en("resp");
    expect(await mouvementManuel(mvt({ ...o, lignes: [[riz, 3]] }))).toMatchObject({ demande: true });
    expect(await stock(riz)).toBe(10);
    expect(await prisma.mouvementStock.count()).toBe(0);
    const [d] = await demandes();
    expect(d).toMatchObject({ nature: "MOUVEMENT_MANUEL", statut: "EN_ATTENTE" });
    expect(d.cibles.map((c) => c.cle)).toEqual([`MOUVEMENT:${riz}`]);
    expect(d.resume).toBe(`${o.type === "ENTREE" ? "Entrée" : "Sortie"} manuelle « ${o.origine} » : Riz 3 Kg`);
    expect(await prisma.notification.count({ where: { refId: d.id, lien: "/stock/a-valider" } })).toBe(1);
  }, 60_000);

  it("double envoi sur le même article : refusé (pas deux sorties validées pour une)", async () => {
    const riz = await article("Riz");
    en("resp");
    await mouvementManuel(mvt({ type: "SORTIE", origine: "Inventaire", lignes: [[riz, 3]] }));
    expect(await mouvementManuel(mvt({ type: "SORTIE", origine: "Inventaire", lignes: [[riz, 3]] }))).toMatchObject({ erreur: expect.stringMatching(/« Riz ».*déjà en attente/) });
    expect(await demandes()).toHaveLength(1);
  }, 60_000);
});

describe("Validation = EXACTEMENT le geste direct de la Direction", () => {
  it.each([["SORTIE" as const, "Inventaire"], ["ENTREE" as const, "Correction"]])("%s « %s » : même stock, même mouvement (date, origine, motif)", async (type, origine) => {
    const direct = await article("Riz A", 10);
    const demande = await article("Riz B", 10);
    en("dir"); await mouvementManuel(mvt({ type, origine, lignes: [[direct, 2.5]] }));
    en("resp"); await mouvementManuel(mvt({ type, origine, lignes: [[demande, 2.5]] }));
    const [d] = await demandes();
    en("dir"); expect(await validerDemandes([d.id], {}, await v([d.id]))).toEqual({ traitees: [d.id], echecs: [] });
    expect(await ecrit(demande)).toEqual(await ecrit(direct));
    expect(await stock(demande)).toBe(type === "SORTIE" ? 7.5 : 12.5);
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: demande } });
    expect(m.creeParId).toBe(U.resp.id); // le mouvement est celui du demandeur ; la validation est sur la demande
    const relue = await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id }, include: { cibles: true } });
    expect(relue).toMatchObject({ statut: "VALIDEE", decideurId: U.dir.id });
    expect(relue.cibles).toEqual([]);
    expect(await prisma.notification.count({ where: { refId: `decision:${d.id}` } })).toBe(1);
  }, 60_000);

  it("le stock a bougé entre-temps : la quantité saisie s'applique telle quelle (un mouvement, pas un stock final)", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await mouvementManuel(mvt({ type: "SORTIE", origine: "Inventaire", lignes: [[riz, 3]] }));
    const [d] = await demandes();
    await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 2]] })); // 8
    en("dir"); await validerDemandes([d.id], {}, await v([d.id]));
    expect(await stock(riz)).toBe(5);
  }, 60_000);

  it("refus : rien n'est écrit, la cible est libérée, le demandeur est notifié", async () => {
    const riz = await article("Riz");
    en("resp"); await mouvementManuel(mvt({ type: "SORTIE", origine: "Inventaire", lignes: [[riz, 3]] }));
    const [d] = await demandes();
    en("dir"); expect(await refuserDemandes([d.id], "Faites un comptage", await v([d.id]))).toMatchObject({ traitees: [d.id] });
    expect(await stock(riz)).toBe(10);
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(await prisma.cibleDemandeStock.count()).toBe(0);
    expect((await prisma.notification.findFirstOrThrow({ where: { refId: `decision:${d.id}` } })).message).toMatch(/refusée.*Faites un comptage/);
  }, 60_000);

  it("droits : le responsable ne valide pas ; un salarié avec accès Stock est traité comme lui", async () => {
    const riz = await article("Riz");
    A.user = { id: U.resp.id, role: "EMPLOYE", nom: "Jean", accesStock: true };
    expect(await mouvementManuel(mvt({ type: "SORTIE", origine: "Inventaire", lignes: [[riz, 3]] }))).toMatchObject({ demande: true });
    const [d] = await demandes();
    expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ erreur: "Réservé à la Direction." });
    en("resp"); expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ erreur: "Réservé à la Direction." });
    expect(await stock(riz)).toBe(10);
  }, 60_000);

  it("article supprimé entre la demande et la validation : conflit, rien d'écrit", async () => {
    const riz = await article("Riz");
    const sel = await article("Sel");
    en("resp"); await mouvementManuel(mvt({ type: "SORTIE", origine: "Inventaire", lignes: [[riz, 3], [sel, 1]] }));
    const [d] = await demandes();
    await prisma.stock.deleteMany({ where: { articleId: sel } });
    await prisma.articleStock.delete({ where: { id: sel } });
    en("dir"); expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/« Sel » n'existe/) }] });
    expect(await stock(riz)).toBe(10);
  }, 60_000);
});
