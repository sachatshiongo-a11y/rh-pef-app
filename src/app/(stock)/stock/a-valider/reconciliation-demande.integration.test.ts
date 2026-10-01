import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { jourKinshasaISO } from "@/lib/date-paiement";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) : réconciliation du stock soumise à la
// validation de la Direction. Vraies actions serveur (réconciliation, mouvements, a-valider).
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

const { appliquerComptage } = await import("../reconciliation/actions");
const { mouvementManuel } = await import("../mouvements/actions");
const { validerDemandes, refuserDemandes } = await import("./actions");

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
  await prisma.sessionComptage.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.articleStock.deleteMany();
});

const article = async (designation: string, quantite: number, prix = 2) => {
  const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "Kg", prixUnitaireUSD: prix } });
  await prisma.stock.create({ data: { articleId: a.id, quantite, stockMinimum: 1 } });
  return a.id;
};
const comptage = (lignes: [string, number, string?][], origine = "Comptage test") => {
  const f = new FormData();
  for (const [id, phys, expl] of lignes) { f.append("recon_articleId", id); f.append("recon_physique", String(phys)); f.append("recon_explication", expl ?? ""); }
  f.set("domaine", "NOURRITURE"); f.set("origine", origine);
  return f;
};
const stock = async (id: string) => Number((await prisma.stock.findUniqueOrThrow({ where: { articleId: id } })).quantite);
const demandes = () => prisma.demandeValidationStock.findMany({ include: { cibles: true }, orderBy: { createdAt: "asc" } });
/** Ce que le comptage a écrit sur un article : stock, ajustements, ligne archivée. */
const ecrit = async (id: string) => ({
  stock: await stock(id),
  ajustements: (await prisma.mouvementStock.findMany({ where: { articleId: id, type: "AJUSTEMENT" } })).map((m) => ({ quantite: m.quantite.toString(), origine: m.origine })),
  lignes: (await prisma.ligneComptage.findMany({ where: { articleId: id } })).map((l) => ({ theorique: l.theorique.toString(), physique: l.physique.toString(), ecart: l.ecart.toString(), ecartPct: l.ecartPct?.toString() ?? null, explication: l.explication })),
});

describe("Comptage du responsable stock", () => {
  it("avec écart : rien n'est écrit (ni stock, ni mouvement, ni archive) — une réconciliation à valider", async () => {
    const riz = await article("Riz", 10);
    en("resp");
    expect(await appliquerComptage(comptage([[riz, 9]]))).toMatchObject({ applique: false, nbEcarts: 1 });
    expect(await stock(riz)).toBe(10);
    expect(await prisma.mouvementStock.count()).toBe(0);
    expect(await prisma.sessionComptage.count()).toBe(0);
    const [d] = await demandes();
    expect(d).toMatchObject({ nature: "RECONCILIATION", statut: "EN_ATTENTE" });
    expect(d.cibles.map((c) => c.cle)).toEqual([`COMPTAGE:${riz}`]);
    expect(await prisma.notification.count({ where: { refId: d.id, lien: "/stock/a-valider" } })).toBe(1);
  }, 60_000);

  it("sans écart : archivé tout de suite (il n'y a rien à ajuster)", async () => {
    const riz = await article("Riz", 10);
    en("resp");
    expect(await appliquerComptage(comptage([[riz, 10]]))).toMatchObject({ applique: true, nbEcarts: 0 });
    expect(await prisma.sessionComptage.count()).toBe(1);
    expect(await demandes()).toEqual([]);
  }, 60_000);

  it("l'explication d'un écart hors tolérance reste exigée — aucune demande sans elle", async () => {
    const riz = await article("Riz", 10);
    en("resp");
    expect(await appliquerComptage(comptage([[riz, 3]]))).toMatchObject({ erreur: expect.stringMatching(/explication/) });
    expect(await demandes()).toEqual([]);
  }, 60_000);

  it("double demande sur un même article refusée", async () => {
    const riz = await article("Riz", 10);
    en("resp");
    await appliquerComptage(comptage([[riz, 9]]));
    expect(await appliquerComptage(comptage([[riz, 9.5]]))).toMatchObject({ erreur: expect.stringMatching(/« Riz ».*déjà en attente/) });
    expect(await demandes()).toHaveLength(1);
  }, 60_000);
});

describe("Validation = l'écriture du comptage direct de la Direction", () => {
  it("stock inchangé depuis le comptage : même stock, même ajustement, même ligne archivée", async () => {
    const direct = await article("Riz A", 10);
    const demande = await article("Riz B", 10);
    en("dir"); await appliquerComptage(comptage([[direct, 8.5, "casse"]], "Inventaire"));
    en("resp"); await appliquerComptage(comptage([[demande, 8.5, "casse"]], "Inventaire"));
    const [d] = await demandes();
    en("dir"); expect(await validerDemandes([d.id])).toEqual({ traitees: [d.id], echecs: [] });
    expect(await ecrit(demande)).toEqual(await ecrit(direct));
    expect((await ecrit(demande)).stock).toBe(8.5);
    const v = await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id }, include: { cibles: true } });
    expect(v.statut).toBe("VALIDEE");
    expect(v.cibles).toEqual([]);
    expect(await prisma.notification.count({ where: { refId: d.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { refId: `decision:${d.id}` } })).toBe(1);
  }, 60_000);

  it("le stock a bougé par des entrées/sorties enregistrées depuis : l'ÉCART constaté est appliqué au stock actuel", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 8, "casse"]])); // écart −2 constaté
    const [d] = await demandes();
    // Datés du jour à Kinshasa, comme les saisit l'écran (une sortie datée d'un jour antérieur serait une saisie tardive).
    const mvt = (type: string, q: number) => { const f = new FormData(); f.set("date", jourKinshasaISO()); f.set("type", type); f.append("articleId", riz); f.append("quantite", String(q)); if (type === "SORTIE") f.set("categorieSortie", "LIVRAISON_RESTAURANT"); else f.set("motifEntree", "RETOUR_RESTAURANT"); return f; }; // flux libres
    await mouvementManuel(mvt("ENTREE", 5)); // 15
    await mouvementManuel(mvt("SORTIE", 1)); // 14
    expect(await stock(riz)).toBe(14);
    en("dir"); expect(await validerDemandes([d.id])).toEqual({ traitees: [d.id], echecs: [] });
    expect(await stock(riz)).toBe(12); // 14 − 2 : ni la livraison ni la sortie ne sont effacées
    const l = await prisma.ligneComptage.findFirstOrThrow({ where: { articleId: riz } });
    expect([l.theorique.toString(), l.physique.toString(), l.ecart.toString()]).toEqual(["10", "8", "-2"]);
  }, 60_000);

  it("conflit : stock changé SANS mouvement qui l'explique → rien n'est écrit, la demande reste en attente", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 8, "casse"]]));
    const [d] = await demandes();
    await prisma.stock.update({ where: { articleId: riz }, data: { quantite: 11 } }); // quantité posée à la main
    en("dir");
    expect(await validerDemandes([d.id])).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/Le stock a bougé.*« Riz ».*sans mouvement.*recompter/) }] });
    expect(await stock(riz)).toBe(11);
    expect(await prisma.sessionComptage.count()).toBe(0);
    expect(await prisma.mouvementStock.count({ where: { type: "AJUSTEMENT" } })).toBe(0);
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  }, 60_000);

  it("conflit : un autre ajustement a été enregistré depuis → refus de ré-appliquer l'ancien écart", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 8, "casse"]]));
    const [d] = await demandes();
    // Ajustement écrit par un autre chemin (import d'inventaire…) après la demande.
    await prisma.mouvementStock.create({ data: { articleId: riz, type: "AJUSTEMENT", quantite: 1, origine: "Import" } });
    await prisma.stock.update({ where: { articleId: riz }, data: { quantite: 9 } });
    en("dir");
    expect(await validerDemandes([d.id])).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/autre comptage ou ajustement/) }] });
    expect(await stock(riz)).toBe(9);
  }, 60_000);

  it("la Direction ne compte pas en direct un article dont une réconciliation attend sa décision", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 8, "casse"]]));
    en("dir");
    expect(await appliquerComptage(comptage([[riz, 9]]))).toMatchObject({ erreur: expect.stringMatching(/« Riz » fait partie d'une réconciliation en attente/) });
    expect(await stock(riz)).toBe(10);
    expect(await prisma.sessionComptage.count()).toBe(0);
  }, 60_000);

  it("saisie TARDIVE : une sortie datée d'avant le comptage, saisie après → conflit (jamais la consommation comptée deux fois)", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 8, "consommation de la veille non saisie"]]));
    const [d] = await demandes();
    const hier = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const f = new FormData(); f.set("type", "SORTIE"); f.append("articleId", riz); f.append("quantite", "3"); f.set("categorieSortie", "LIVRAISON_RESTAURANT"); f.set("date", hier);
    await mouvementManuel(f);
    en("dir");
    expect(await validerDemandes([d.id])).toMatchObject({ echecs: [{ erreur: expect.stringMatching(/datée d'avant le comptage/) }] });
    expect(await stock(riz)).toBe(7);
  }, 60_000);

  it("l'archive du comptage validé porte le compteur et le jour du comptage, pas ceux de la validation", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 9]]));
    const [d] = await demandes();
    const ilYaCinqJours = new Date(Date.now() - 5 * 86_400_000);
    await prisma.demandeValidationStock.update({ where: { id: d.id }, data: { createdAt: ilYaCinqJours } });
    en("dir"); await validerDemandes([d.id]);
    const s = await prisma.sessionComptage.findFirstOrThrow();
    expect(s.creeParId).toBe(U.resp.id);
    expect(s.date.toISOString().slice(0, 10)).toBe(new Date(ilYaCinqJours.getTime() + 3_600_000).toISOString().slice(0, 10));
  }, 60_000);

  it("un article compté deux fois dans le même comptage est refusé (quel chiffre croire ?)", async () => {
    const riz = await article("Riz", 10);
    en("dir");
    expect(await appliquerComptage(comptage([[riz, 9], [riz, 9.5]]))).toMatchObject({ erreur: expect.stringMatching(/« Riz » est compté deux fois/) });
    expect(await stock(riz)).toBe(10);
  }, 60_000);

  it("refus : le stock ne bouge pas, la cible est libérée", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 8, "casse"]]));
    const [d] = await demandes();
    en("dir"); expect(await refuserDemandes([d.id], "Recompter demain")).toMatchObject({ traitees: [d.id] });
    expect(await stock(riz)).toBe(10);
    expect(await prisma.cibleDemandeStock.count()).toBe(0);
  }, 60_000);

  it("droits : le responsable ne valide pas sa propre réconciliation", async () => {
    const riz = await article("Riz", 10);
    en("resp"); await appliquerComptage(comptage([[riz, 8, "casse"]]));
    const [d] = await demandes();
    expect(await validerDemandes([d.id])).toMatchObject({ erreur: "Réservé à la Direction." });
    expect(await stock(riz)).toBe(10);
  }, 60_000);
});
