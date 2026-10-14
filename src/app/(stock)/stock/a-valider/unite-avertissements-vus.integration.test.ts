import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Approbation d'un changement d'UNITÉ (relecture du 2026-10-14) : les avertissements (stock, historique, prix, fiches,
// rattachement) sont calculés à l'affichage de « À valider » ; entre l'affichage et le clic, un article peut avoir reçu du
// stock ou un mouvement. Le jeton de version porte l'empreinte des avertissements AFFICHÉS : le serveur recalcule à
// l'approbation et refuse, en nommant l'article, si l'ensemble a changé — approbation seule ou groupée.
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

const { changerUniteEnMasse } = await import("../catalogue/actions");
const { validerDemandes, refuserDemandes } = await import("./actions");
const { apercusDemandes } = await import("@/lib/validations-stock/apercu");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const U = { dir: { id: "", role: "ADMIN", nom: "Sacha", accesStock: false }, resp: { id: "", role: "STOCK", nom: "Jean", accesStock: false }, autre: { id: "", role: "STOCK", nom: "Marie", accesStock: false } };
const en = (u: keyof typeof U) => { A.user = { ...U[u] }; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const [k, role] of [["dir", "ADMIN"], ["resp", "STOCK"], ["autre", "STOCK"]] as const) U[k].id = (await prisma.user.create({ data: { email: `${k}@pef.cd`, nom: U[k].nom, role } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  en("dir");
  await prisma.cibleDemandeStock.deleteMany();
  await prisma.demandeValidationStock.deleteMany();
  await prisma.journalAudit.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const art = async (designation: string, quantite = 0) => (await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", stock: { create: { quantite } } } })).id;
const unite = async (id: string) => (await prisma.articleStock.findUniqueOrThrow({ where: { id } })).unite;
/** Ce que « À valider » AFFICHE pour cette demande : le jeton de version (avec l'empreinte des avertissements) et les avertissements. */
const affiche = async (id: string) => { const [a] = await apercusDemandes({ id }, { detail: true }); return a; };
const proposer = async (auteur: keyof typeof U, ids: string[], u = "g") => {
  en(auteur);
  const avant = new Set((await prisma.demandeValidationStock.findMany({ select: { id: true } })).map((d) => d.id));
  await changerUniteEnMasse(ids, u);
  const d = (await prisma.demandeValidationStock.findMany({ where: { statut: "EN_ATTENTE" } })).find((x) => !avant.has(x.id))!;
  en("dir");
  return d.id;
};
const echec = (r: unknown) => (r as { echecs: { id: string; erreur: string }[] }).echecs;

describe("approbation d'un changement d'unité : les avertissements vus sont revérifiés au clic", () => {
  it("un article qui a reçu un mouvement depuis l'affichage REFUSE l'approbation, en le nommant ; rien n'est écrit ; rechargé, l'approbation passe", async () => {
    const farine = await art("Farine", 12), cannelle = await art("Cannelle");
    const d = await proposer("resp", [farine, cannelle]);
    const vu = await affiche(d);
    expect(vu.article!.articles.find((a) => a.id === farine)!.avertissements).toBeTruthy();
    expect(vu.article!.articles.find((a) => a.id === cannelle)!.avertissements).toBeUndefined(); // libre : rien à lire

    // Entre l'affichage et le clic : la cannelle (libre à l'affichage) reçoit une entrée de stock.
    await prisma.mouvementStock.create({ data: { articleId: cannelle, type: "ENTREE", quantite: 3, date: new Date("2026-09-03") } });
    await prisma.stock.update({ where: { articleId: cannelle }, data: { quantite: 3 } });

    const r = await validerDemandes([d], {}, { [d]: vu.version });
    expect(r).toMatchObject({ traitees: [] });
    expect(echec(r)[0].erreur).toBe("« Cannelle » a reçu du stock, de l'historique ou un rattachement depuis l'affichage (stock 3 kg, 1 mouvement) : rechargez la page, l'avertissement sera à jour. Rien n'a été approuvé.");
    expect(await unite(farine)).toBe("kg");
    expect(await unite(cannelle)).toBe("kg");
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d } })).statut).toBe("EN_ATTENTE");

    // La Direction recharge : l'avertissement de la cannelle est là, et l'approbation passe.
    const recharge = await affiche(d);
    expect(recharge.article!.articles.find((a) => a.id === cannelle)!.avertissements!.join(" ")).toContain("stock 3 kg, 1 mouvement");
    expect(recharge.version).not.toBe(vu.version);
    expect(await validerDemandes([d], {}, { [d]: recharge.version })).toEqual({ traitees: [d], echecs: [] });
    expect(await unite(farine)).toBe("g");
    expect(await unite(cannelle)).toBe("g");
  }, 90_000);

  it("un avertissement DÉJÀ vu qui a changé (la farine a reçu un mouvement de plus) refuse aussi", async () => {
    const farine = await art("Farine", 12);
    const d = await proposer("resp", [farine]);
    const vu = await affiche(d);
    await prisma.mouvementStock.create({ data: { articleId: farine, type: "SORTIE", quantite: 2, date: new Date("2026-09-04") } });
    const r = await validerDemandes([d], {}, { [d]: vu.version });
    expect(echec(r)[0].erreur).toMatch(/^« Farine » a changé depuis l'affichage \(stock 12 kg, 1 mouvement\) : rechargez la page/);
    expect(await unite(farine)).toBe("kg");
  }, 90_000);

  it("approbation GROUPÉE : la demande périmée est refusée, l'autre est approuvée — le contrôle ne se contourne pas par le lot", async () => {
    const a = await art("Farine", 12), b = await art("Sucre", 5);
    const d1 = await proposer("resp", [a]);
    const d2 = await proposer("autre", [b]);
    const [v1, v2] = [await affiche(d1), await affiche(d2)];
    await prisma.mouvementStock.create({ data: { articleId: a, type: "ENTREE", quantite: 1, date: new Date("2026-09-05") } });
    const r = await validerDemandes([d1, d2], {}, { [d1]: v1.version, [d2]: v2.version });
    expect(r).toMatchObject({ traitees: [d2] });
    expect(echec(r)).toHaveLength(1);
    expect(echec(r)[0]).toMatchObject({ id: d1 });
    expect(echec(r)[0].erreur).toContain("« Farine » a changé depuis l'affichage");
    expect(await unite(a)).toBe("kg");
    expect(await unite(b)).toBe("g");
  }, 90_000);

  it("jeton NU (appel direct, avertissements jamais affichés) : refusé pour une demande qui change une unité", async () => {
    const a = await art("Farine", 12);
    const d = await proposer("resp", [a]);
    const nu = (await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d } })).updatedAt.toISOString();
    const r = await validerDemandes([d], {}, { [d]: nu });
    expect(echec(r)[0].erreur).toContain("Cette demande change des unités : rechargez la page avant de l'approuver");
    expect(await unite(a)).toBe("kg");
  }, 90_000);

  it("rien n'a changé depuis l'affichage : approuvé ; le refus de la demande accepte le même jeton", async () => {
    const a = await art("Farine", 12), b = await art("Sucre", 5);
    const d1 = await proposer("resp", [a]);
    const d2 = await proposer("autre", [b]);
    const [v1, v2] = [await affiche(d1), await affiche(d2)];
    expect(await validerDemandes([d1], {}, { [d1]: v1.version })).toEqual({ traitees: [d1], echecs: [] });
    expect(await refuserDemandes([d2], "Pas maintenant", { [d2]: v2.version })).toEqual({ traitees: [d2], echecs: [] });
    expect(await unite(a)).toBe("g");
    expect(await unite(b)).toBe("kg");
  }, 90_000);
});
