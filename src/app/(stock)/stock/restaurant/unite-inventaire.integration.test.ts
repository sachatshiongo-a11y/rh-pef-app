import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

/**
 * UNE SEULE UNITÉ PAR PRODUIT : celle de l'Inventaire (règle de la Direction, 2026-10-12), sur une VRAIE
 * base. Rattacher exige la même unité ; l'unité d'un article rattaché suit l'Inventaire ; les écarts
 * d'avant la règle se corrigent par « Aligner sur l'Inventaire » — effet montré avant, conversion EXACTE
 * des comptages et du stock de base, journalisée, refusée si impossible ; un compte Stock le DEMANDE.
 */
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
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireModule: () => {},
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const { ajouterLiensResto, alignerUnitesResto, modifierArticleResto } = await import("./actions");
const { validerDemandes } = await import("../a-valider/actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error(`Acceptée alors qu'elle aurait dû être refusée : ${JSON.stringify(r)}`);
};
const ids: Record<string, string> = {};

/** Un article du restaurant « Sonde » compté en kg, rattaché à un article de l'Inventaire en `uniteInv`. */
async function sonde(uniteResto: string, uniteInv: string, comptages: [string, number][], base: number | null = 10) {
  const inv = await prisma.articleStock.create({ data: { designation: `Sonde ${uniteInv}`, domaine: "NOURRITURE", unite: uniteInv } });
  const r = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Sonde", unite: uniteResto, stockBaseJournalier: base, liens: { create: { articleStockId: inv.id } } } });
  for (const [d, q] of comptages) await prisma.comptageResto.create({ data: { articleRestoId: r.id, date: le(d), quantite: q } });
  return { inv: inv.id, resto: r.id };
}
const quantites = async (restoId: string) => (await prisma.comptageResto.findMany({ where: { articleRestoId: restoId }, orderBy: { date: "asc" } })).map((c) => c.quantite.toString());
const version = async (id: string) => (await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"]] as const) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  await prisma.cibleDemandeStock.deleteMany(); await prisma.demandeValidationStock.deleteMany(); await prisma.notification.deleteMany();
  await prisma.journalAudit.deleteMany(); await prisma.comptageResto.deleteMany(); await prisma.articleRestoStock.deleteMany(); await prisma.articleResto.deleteMany();
  en("dir");
});

describe("rattacher exige la même unité que l'Inventaire", () => {
  it("une marque d'une AUTRE unité est refusée, avec le message de la règle ; la même unité (casse, pluriel) passe", async () => {
    const lurpak = await prisma.articleStock.create({ data: { designation: "Beurre Lurpak", domaine: "NOURRITURE", unite: "Pièce" } });
    const president = await prisma.articleStock.create({ data: { designation: "Beurre Président", domaine: "NOURRITURE", unite: "Kg" } });
    const beurre = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Beurre", unite: "kg" } });
    const e = erreurDe(await ajouterLiensResto(beurre.id, [lurpak.id]));
    expect(e).toContain("« Beurre Lurpak » est en Pièce dans l'Inventaire, « Beurre » est en kg : alignez l'unité dans l'Inventaire d'abord");
    expect(await prisma.articleRestoStock.count()).toBe(0);
    expect(await ajouterLiensResto(beurre.id, [president.id])).toEqual({ n: 1 }); // « Kg » = « kg »
  });

  it("compte Stock : la même règle s'applique dès la demande (aucune demande déposée pour une unité différente)", async () => {
    const lurpak = await prisma.articleStock.create({ data: { designation: "Beurre Lurpak", domaine: "NOURRITURE", unite: "Pièce" } });
    const beurre = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Beurre", unite: "kg" } });
    en("resp");
    expect(erreurDe(await ajouterLiensResto(beurre.id, [lurpak.id]))).toContain("alignez l'unité dans l'Inventaire d'abord");
    expect(await prisma.demandeValidationStock.count()).toBe(0);
  });

  it("l'unité d'un article RATTACHÉ ne se saisit plus à la main : seule l'unité de l'Inventaire (même normalisée) est admise", async () => {
    const { resto } = await sonde("kg", "kg", []);
    const e = erreurDe(await modifierArticleResto(resto, fd({ unite: "g" })));
    expect(e).toContain("est celle de l'Inventaire");
    expect(e).toContain("Aligner sur l'Inventaire");
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: resto } })).unite).toBe("kg");
    expect(await modifierArticleResto(resto, fd({ unite: "Kg" }))).toBeUndefined(); // même unité, orthographe corrigée
    // Non rattaché : libre, comme avant.
    const libre = await prisma.articleResto.create({ data: { espace: "BAR", designation: "Libre", unite: "kg" } });
    expect(await modifierArticleResto(libre.id, fd({ unite: "g" }))).toBeUndefined();
  });
});

describe("aligner sur l'Inventaire : effet montré, conversion exacte, une transaction, journal", () => {
  it("Direction : première passe = l'effet (rien n'est écrit) ; confirmée = unité, comptages et stock de base convertis exactement", async () => {
    const { resto } = await sonde("kg", "g", [["2026-10-01", 4.5], ["2026-10-02", 2], ["2026-10-03", 0.125]]);
    const apercu = await alignerUnitesResto([resto]);
    expect(apercu).toMatchObject({ ok: false, aConfirmer: true });
    const m = (apercu as { message: string }).message;
    expect(m).toContain("« Sonde » : kg → g (×1 000)");
    expect(m).toContain("3 comptage(s) convertis (dernier : 0,125 kg → 125 g)");
    expect(m).toContain("stock de base 10 kg → 10 000 g");
    expect(await quantites(resto)).toEqual(["4.5", "2", "0.125"]); // rien d'écrit
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: resto } })).unite).toBe("kg");

    expect(await alignerUnitesResto([resto], true)).toEqual({ ok: true, modifies: 1 });
    expect(await quantites(resto)).toEqual(["4500", "2000", "125"]);
    const r = await prisma.articleResto.findUniqueOrThrow({ where: { id: resto } });
    expect([r.unite, r.stockBaseJournalier!.toString()]).toEqual(["g", "10000"]);
    const j = await prisma.journalAudit.findMany({ orderBy: { date: "asc" } });
    expect(j.filter((x) => x.entite === "ComptageResto").map((x) => [x.ancienneValeur, x.nouvelleValeur]).sort()).toEqual([["0.125 kg", "125 g"], ["2 kg", "2000 g"], ["4.5 kg", "4500 g"]]);
    expect(j.find((x) => x.champ.startsWith("unite"))).toMatchObject({ ancienneValeur: "kg", nouvelleValeur: "g", userId: U.dir.id });
    // Plus d'écart : une nouvelle passe n'a rien à faire.
    expect(await alignerUnitesResto([resto], true)).toEqual({ ok: true, modifies: 0 });
  });

  it("g → kg quand la valeur ne tient pas en 3 décimales (4,5 g = 0,0045 kg) : refusé, rien n'est écrit", async () => {
    const { resto } = await sonde("g", "kg", [["2026-10-01", 4.5], ["2026-10-02", 2000]], null);
    const e = erreurDe(await alignerUnitesResto([resto], true));
    expect(e).toContain("ne tiennent pas en 3 décimales");
    expect(e).toContain("rien n'a été écrit");
    expect(await quantites(resto)).toEqual(["4.5", "2000"]);
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: resto } })).unite).toBe("g");
  });

  it("g → kg exact (2 000 g, 500 g) : converti", async () => {
    const { resto } = await sonde("g", "kg", [["2026-10-01", 2000], ["2026-10-02", 500]], null);
    expect(await alignerUnitesResto([resto], true)).toEqual({ ok: true, modifies: 1 });
    expect(await quantites(resto)).toEqual(["2", "0.5"]);
  });

  it("non convertible (kg contre litre) : refusé, nommé, rien n'est écrit", async () => {
    const { resto } = await sonde("kg", "L", [["2026-10-01", 4.5]]);
    const e = erreurDe(await alignerUnitesResto([resto], true));
    expect(e).toContain("non convertible");
    expect(e).toContain("Rien n'a été aligné");
    expect(await quantites(resto)).toEqual(["4.5"]);
  });

  it("compte Stock : il DEMANDE (rien n'est converti) ; la Direction valide → conversion exacte ; périmée (unité changée entre-temps) → refusée", async () => {
    const { resto, inv } = await sonde("kg", "g", [["2026-10-01", 4.5]]);
    en("resp");
    expect(await alignerUnitesResto([resto], true)).toEqual({ ok: true, modifies: 0, enAttente: 1 });
    expect(await quantites(resto)).toEqual(["4.5"]);
    const [d] = await prisma.demandeValidationStock.findMany({ where: { nature: "UNITE_RESTO" } });
    expect(d).toMatchObject({ statut: "EN_ATTENTE", auteurId: U.resp.id });
    expect(d!.resume).toContain("Aligner l'unité de « Sonde » sur l'Inventaire : kg → g");

    en("dir");
    // Périmée : l'Inventaire passe en « kg » entre-temps (l'article est déjà aligné) → la validation refuse, rien n'est écrit.
    await prisma.articleStock.update({ where: { id: inv }, data: { unite: "kg" } });
    const r1 = await validerDemandes([d!.id], {}, { [d!.id]: await version(d!.id) });
    expect(JSON.stringify(r1)).toContain("plus d'écart d'unité");
    expect(await quantites(resto)).toEqual(["4.5"]);
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d!.id } })).statut).toBe("EN_ATTENTE");

    await prisma.articleStock.update({ where: { id: inv }, data: { unite: "g" } });
    const r2 = await validerDemandes([d!.id], {}, { [d!.id]: await version(d!.id) });
    expect(JSON.stringify(r2)).not.toContain("erreur");
    expect(await quantites(resto)).toEqual(["4500"]);
    expect((await prisma.articleResto.findUniqueOrThrow({ where: { id: resto } })).unite).toBe("g");
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d!.id } })).statut).toBe("VALIDEE");
  });
});
