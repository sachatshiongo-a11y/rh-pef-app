import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { ecrireSaisieNombre } from "@/lib/nombre";
import { deposerAncienneDemandeMouvement } from "@/lib/test/ancienne-demande-mouvement";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : les demandes MOUVEMENT_MANUEL restées EN
// ATTENTE en production. Du 2026-10-01 au 2026-10-07, une entrée/sortie manuelle hors Direction devenait
// une demande ; depuis le 2026-10-07 (décision de Sacha), elle est écrite tout de suite et notifiée
// (voir mouvements/gestes-notifies.integration.test.ts). Les anciennes demandes, déposées ici comme
// l'application le faisait (lib/test/ancienne-demande-mouvement.ts), restent décidables par la
// Direction. Une SORTIE ne s'écrit plus sans motif : la Direction le choisit en la validant.
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
const PUSH = vi.hoisted(() => ({ casser: false }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => { if (PUSH.casser) throw new Error("push en panne"); } }));

const { mouvementManuel } = await import("../mouvements/actions");
const { validerDemandes, refuserDemandes } = await import("./actions");
const { appliquerComptage } = await import("../reconciliation/actions");

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
  for (const [id, q] of o.lignes) { f.append("articleId", id); f.append("quantite", typeof q === "number" ? ecrireSaisieNombre(q) : String(q)); } // écrite comme à l'écran : virgule décimale
  return f;
};
const stock = async (id: string) => Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: id } })).quantite);
const demandes = () => prisma.demandeValidationStock.findMany({ include: { cibles: true }, orderBy: { createdAt: "asc" } });
/** Ce qu'un mouvement a écrit sur un article (sans identifiants ni horodatage). */
const ecrit = async (id: string) => ({
  stock: await stock(id),
  mouvements: (await prisma.mouvementStock.findMany({ where: { articleId: id } })).map((m) => ({ type: m.type, quantite: m.quantite.toString(), origine: m.origine, date: m.date.toISOString(), categorieSortie: m.categorieSortie, raisonSortie: m.raisonSortie })),
});

const ancienne = (o: { type: "ENTREE" | "SORTIE"; origine: string; lignes: [string, number][]; date?: string }) =>
  deposerAncienneDemandeMouvement(prisma, { auteur: { id: U.resp.id, nom: U.resp.nom }, date: o.date ?? DATE, ...o });
const motif = (id: string, categorie: string, raison?: string) => ({ [id]: { categorie, raison } });

describe("Plus aucune demande créée : le geste du responsable est écrit tout de suite", () => {
  it.each([
    ["sortie « Perte » (motif obligatoire)", { type: "SORTIE" as const, categorieSortie: "PERTE", raisonSortie: "Inventaire" }, 7],
    ["sortie « Livraison restaurant »", { type: "SORTIE" as const, categorieSortie: "LIVRAISON_RESTAURANT" }, 7],
    ["entrée (correction)", { type: "ENTREE" as const, origine: "Correction" }, 13],
    ["entrée « Retour restaurant »", { type: "ENTREE" as const, motifEntree: "RETOUR_RESTAURANT" }, 13],
  ])("%s", async (_n, o, attendu) => {
    const riz = await article("Riz");
    en("resp");
    expect(await mouvementManuel(mvt({ ...o, lignes: [[riz, 3]] }))).toMatchObject({ demande: false });
    expect(await stock(riz)).toBe(attendu);
    expect(await demandes()).toEqual([]);
    expect(await prisma.notification.count({ where: { lien: "/stock/a-valider" } })).toBe(0);
  }, 60_000);
});

describe("Double saisie possible : ancienne demande en attente + même article saisi en direct", () => {
  it("le geste est écrit (rien n'est bloqué), l'auteur et la Direction sont avertis, la carte de la demande le signale", async () => {
    const riz = await article("Riz", 10);
    const d = await ancienne({ type: "SORTIE", origine: "Sortie / consommation", lignes: [[riz, 3]] });
    en("resp");
    const r = await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 3]] }));
    expect(r).toMatchObject({ demande: false, message: expect.stringMatching(/Sortie enregistrée.*Attention : une ancienne demande en attente de la Direction vise aussi « Riz »/) });
    expect(await stock(riz)).toBe(7);
    const n = await prisma.notification.findFirstOrThrow({ where: { destinataireUserId: U.dir.id, refId: { startsWith: "geste:" } } });
    expect(n.message).toBe("Sortie de 3 Kg — Riz (Livraison restaurant) par Jean — attention : une ancienne demande en attente vise aussi « Riz » (double saisie ?)");
    const { apercusDemandes } = await import("@/lib/validations-stock/apercu");
    const [a] = await apercusDemandes({ id: d.id }, { detail: true });
    expect(a.mouvement?.saisisDepuis).toEqual(["Riz"]);
    expect(a.alertes).toEqual([]); // une alerte, pas un conflit : la Direction tranche
  }, 60_000);
});

describe("Anciennes demandes en attente : toujours décidables", () => {
  it.each([["SORTIE" as const, "Sortie / consommation"], ["ENTREE" as const, "Correction"]])("%s « %s » validée = EXACTEMENT le geste direct (stock, date, origine, motif)", async (type, origine) => {
    const direct = await article("Riz A", 10);
    const demande = await article("Riz B", 10);
    en("dir");
    const directe = type === "SORTIE" ? { type, categorieSortie: "PERTE", raisonSortie: "Inventaire" } : { type, origine };
    await mouvementManuel(mvt({ ...directe, lignes: [[direct, 2.5]] }));
    const d = await ancienne({ type, origine, lignes: [[demande, 2.5]] });
    expect(await validerDemandes([d.id], {}, await v([d.id]), type === "SORTIE" ? motif(d.id, "PERTE", "Inventaire") : {})).toEqual({ traitees: [d.id], echecs: [] });
    expect(await ecrit(demande)).toEqual(await ecrit(direct));
    expect(await stock(demande)).toBe(type === "SORTIE" ? 7.5 : 12.5);
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: demande } });
    expect(m.creeParId).toBe(U.resp.id); // le mouvement est celui du demandeur ; la validation est sur la demande
    const relue = await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id }, include: { cibles: true } });
    expect(relue).toMatchObject({ statut: "VALIDEE", decideurId: U.dir.id });
    expect(relue.cibles).toEqual([]);
    expect(await prisma.notification.count({ where: { refId: d.id } })).toBe(0); // la cloche « À valider » est retirée
    expect(await prisma.notification.count({ where: { refId: `decision:${d.id}` } })).toBe(1);
  }, 60_000);

  it("ancienne SORTIE sans motif : la valider exige un motif (rien d'écrit sans lui), « Perte » exige sa raison", async () => {
    const riz = await article("Riz", 10);
    const d = await ancienne({ type: "SORTIE", origine: "Sortie / consommation", lignes: [[riz, 3]] });
    en("dir");
    expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/Choisissez le motif de cette sortie/) }] });
    expect(await validerDemandes([d.id], {}, await v([d.id]), motif(d.id, ""))).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/Choisissez le motif/) }] });
    expect(await validerDemandes([d.id], {}, await v([d.id]), motif(d.id, "PERTE", "  "))).toMatchObject({ echecs: [{ erreur: "Indiquez la raison de la perte." }] });
    expect(await stock(riz)).toBe(10);
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
    expect(await validerDemandes([d.id], {}, await v([d.id]), motif(d.id, "LIVRAISON_RESTAURANT"))).toEqual({ traitees: [d.id], echecs: [] });
    const m = await prisma.mouvementStock.findFirstOrThrow({ where: { articleId: riz } });
    expect([m.type, m.categorieSortie, m.raisonSortie, m.origine]).toEqual(["SORTIE", "LIVRAISON_RESTAURANT", null, "Livraison restaurant"]);
    expect(await stock(riz)).toBe(7);
  }, 60_000);

  it("le stock a bougé entre-temps : la quantité saisie s'applique telle quelle (un mouvement, pas un stock final)", async () => {
    const riz = await article("Riz", 10);
    const d = await ancienne({ type: "SORTIE", origine: "Sortie / consommation", lignes: [[riz, 3]] });
    en("resp"); await mouvementManuel(mvt({ type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", lignes: [[riz, 2]] })); // 8
    en("dir"); await validerDemandes([d.id], {}, await v([d.id]), motif(d.id, "LIVRAISON_RESTAURANT"));
    expect(await stock(riz)).toBe(5);
  }, 60_000);

  it("refus : rien n'est écrit, la cible est libérée, le demandeur est notifié", async () => {
    const riz = await article("Riz");
    const d = await ancienne({ type: "SORTIE", origine: "Sortie / consommation", lignes: [[riz, 3]] });
    en("dir"); expect(await refuserDemandes([d.id], "Faites un comptage", await v([d.id]))).toMatchObject({ traitees: [d.id] });
    expect(await stock(riz)).toBe(10);
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(await prisma.cibleDemandeStock.count()).toBe(0);
    expect((await prisma.notification.findFirstOrThrow({ where: { refId: `decision:${d.id}` } })).message).toMatch(/refusée.*Faites un comptage/);
  }, 60_000);

  it("droits : le responsable ne valide pas ; un salarié avec accès Stock non plus", async () => {
    const riz = await article("Riz");
    const d = await ancienne({ type: "ENTREE", origine: "Correction", lignes: [[riz, 3]] });
    A.user = { id: U.resp.id, role: "EMPLOYE", nom: "Jean", accesStock: true };
    expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ erreur: "Réservé à la Direction." });
    en("resp"); expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ erreur: "Réservé à la Direction." });
    expect(await stock(riz)).toBe(10);
  }, 60_000);

  it("D1 — la Direction ne compte pas en direct un article dont une ancienne sortie manuelle attend sa décision", async () => {
    const riz = await article("Riz", 10);
    await ancienne({ type: "SORTIE", origine: "Sortie / consommation", lignes: [[riz, 3]] });
    en("dir");
    const f = new FormData(); f.append("recon_articleId", riz); f.append("recon_physique", "7"); f.append("recon_explication", "sortie non saisie"); f.set("origine", "Comptage");
    expect(await appliquerComptage(f)).toMatchObject({ erreur: expect.stringMatching(/« Riz » fait partie d'un mouvement manuel en attente/) });
    expect(await stock(riz)).toBe(10);
  }, 60_000);

  it("D1 — un comptage/ajustement intervenu depuis la demande : la sortie n'est pas retranchée une 2e fois (jamais 4 au lieu de 7)", async () => {
    const riz = await article("Riz", 10);
    const d = await ancienne({ type: "SORTIE", origine: "Sortie / consommation", lignes: [[riz, 3]] });
    await prisma.mouvementStock.create({ data: { articleId: riz, type: "AJUSTEMENT", quantite: 3, origine: "Inventaire importé" } });
    await prisma.stock.update({ where: { articleId: riz }, data: { quantite: 7 } });
    en("dir");
    expect(await validerDemandes([d.id], {}, await v([d.id]), motif(d.id, "LIVRAISON_RESTAURANT"))).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/comptage ou ajustement a eu lieu depuis la demande sur « Riz »/) }] });
    expect(await stock(riz)).toBe(7);
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  }, 60_000);

  it("article supprimé entre la demande et la validation : conflit, rien d'écrit", async () => {
    const riz = await article("Riz");
    const sel = await article("Sel");
    const d = await ancienne({ type: "ENTREE", origine: "Correction", lignes: [[riz, 3], [sel, 1]] });
    await prisma.stock.deleteMany({ where: { articleId: sel } });
    await prisma.articleStock.delete({ where: { id: sel } });
    en("dir"); expect(await validerDemandes([d.id], {}, await v([d.id]))).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/« Sel » n'existe/) }] });
    expect(await stock(riz)).toBe(10);
  }, 60_000);
});
