// Revue indépendante du 2026-10-12 (lot « plusieurs fournisseurs par article »).
//  1. La migration rejouée DEPUIS ZÉRO (la base de test `db push` a déjà la table : ici on la supprime pour exercer le
//     vrai CREATE TABLE, les clés étrangères, l'index partiel), sur des données réalistes (article sans fournisseur,
//     fournisseur supprimé, facture sans date / sans lignes) ; idempotente ; schéma identique à celui de Prisma.
//  2. CHAQUE geste « fournisseurs » appelé directement en rôle STOCK : une proposition, jamais une écriture — la base
//     (liens ET colonne de compatibilité) est strictement identique avant/après. Justifie les 8 exceptions de
//     suppressions-direction.test.ts.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", accesStock: false } }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }) }));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("NEXT_REDIRECT"); } }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const C = await import("./actions");
const SQL = fs.readFileSync(path.join(__dirname, "../../../../../prisma/migrations/20261016110000_article_fournisseurs/migration.sql"), "utf8");

let prisma: PrismaClient; let fermer: () => Promise<void>; let pg: Client; let url: string;
let f1: string, f2: string, f3: string, stockId: string;
beforeAll(async () => {
  const db = await creerBaseTest(); prisma = db.prisma; fermer = db.fermer; H.client = prisma; url = db.url;
  pg = new Client({ connectionString: db.url }); await pg.connect();
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "D", role: "ADMIN" } })).id;
  stockId = (await prisma.user.create({ data: { email: "s@pef.cd", nom: "S", role: "STOCK" } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  f1 = (await prisma.fournisseur.create({ data: { nom: "F1" } })).id;
  f2 = (await prisma.fournisseur.create({ data: { nom: "F2" } })).id;
  f3 = (await prisma.fournisseur.create({ data: { nom: "F3" } })).id;
}, 180_000);
afterAll(async () => { await pg?.end(); await fermer?.(); });

describe("migration rejouée depuis zéro (CREATE TABLE réel)", () => {
  it("table absente -> migration -> mêmes structures que Prisma ; données réalistes", async () => {
    await pg.query(`DROP TABLE stock."ArticleFournisseur"`);
    const art = (d: string, fournisseurId?: string) => prisma.articleStock.create({ data: { designation: d, domaine: "NOURRITURE", ...(fournisseurId ? { fournisseurId } : {}) } });
    const a1 = await art("a1", f1), a2 = await art("a2"), a3 = await art("a3", f2), a4 = await art("a4");
    const supp = await prisma.fournisseur.create({ data: { nom: "Supprimé" } });
    // facture sans date, facture sans lignes, facture au fournisseur supprimé (-> fournisseurId null)
    await prisma.factureFournisseur.create({ data: { fournisseurId: f3, fournisseurNom: "F3", mois: 9, annee: 2026, montantUSD: 1, lignes: { create: [{ articleId: a2.id, designation: "x", quantite: 1, prixUnitaireUSD: 1 }] } } });
    await prisma.factureFournisseur.create({ data: { fournisseurId: f3, fournisseurNom: "F3", mois: 9, annee: 2026, montantUSD: 1 } });
    await prisma.factureFournisseur.create({ data: { fournisseurId: supp.id, fournisseurNom: "Supprimé", mois: 9, annee: 2026, date: new Date("2026-09-01"), montantUSD: 1, lignes: { create: [{ articleId: a4.id, designation: "x", quantite: 1, prixUnitaireUSD: 1 }] } } });
    await prisma.mouvementStock.create({ data: { articleId: a4.id, type: "ENTREE", quantite: 1, fournisseurId: supp.id } });
    await prisma.fournisseur.delete({ where: { id: supp.id } });
    await pg.query(SQL);
    const rows = (await pg.query(`SELECT a.designation d, f.nom n, l.habituel h, l.source s FROM stock."ArticleFournisseur" l JOIN stock."ArticleStock" a ON a.id=l."articleId" JOIN stock."Fournisseur" f ON f.id=l."fournisseurId" ORDER BY 1,2`)).rows;
    expect(rows).toEqual([{ d: "a1", n: "F1", h: true, s: "HISTORIQUE" }, { d: "a2", n: "F3", h: false, s: "HISTORIQUE" }, { d: "a3", n: "F2", h: true, s: "HISTORIQUE" }]);
    await pg.query(SQL); // idempotent
    expect((await pg.query(`SELECT count(*)::int c FROM stock."ArticleFournisseur"`)).rows[0].c).toBe(3);
    // Prisma voit la même chose que son schéma
    const out = execSync(`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, { encoding: "utf8", env: { ...process.env, DIRECT_URL: url, DATABASE_URL: url } });
    expect(out).toMatch(/empty migration/); // la table créée par la migration = celle du schéma Prisma (l'index partiel est ignoré par Prisma)
    // Code d'avant la bascule (l'ancien code écrit encore la colonne seule, sans lien) : la migration REJOUÉE après coup
    // se heurte à l'index « un seul habituel » — elle n'est pas rejouable après des écritures de l'ancien code (revue du
    // 2026-10-12 : sans conséquence, Prisma ne la rejoue jamais ; documenté ici pour qu'on ne la relance pas à la main).
    await pg.query(`UPDATE stock."ArticleStock" SET "fournisseurId"=$1 WHERE id=$2`, [f3, a1.id]);
    await expect(pg.query(SQL)).rejects.toThrow(/ArticleFournisseur_un_habituel_key/);
  }, 120_000);
});

describe("hors Direction : appel direct de chaque action en rôle STOCK", () => {
  beforeEach(async () => {
    A.user = { id: stockId, role: "STOCK", nom: "S", accesStock: false };
    await prisma.cibleDemandeStock.deleteMany(); await prisma.demandeValidationStock.deleteMany();
    await prisma.stock.deleteMany(); await prisma.articleStock.deleteMany();
  });
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const snap = async () => ({ liens: await prisma.articleFournisseur.findMany({ orderBy: [{ articleId: "asc" }, { fournisseurId: "asc" }] }), arts: (await prisma.articleStock.findMany({ orderBy: { id: "asc" } })).map((a) => ({ ...a, updatedAt: 0 })) });
  const cas: [string, (id: string) => Promise<unknown>][] = [
    ["modifierArticle retrait liste", (id) => C.modifierArticle(id, fd({ fournisseursIds: f2 }))],
    ["modifierArticle habituel null", (id) => C.modifierArticle(id, fd({ fournisseurId: "" }))],
    ["changerDomaineEnMasse", (id) => C.changerDomaineEnMasse([id], "BOISSON")],
    ["definirFournisseurEnMasse f3", (id) => C.definirFournisseurEnMasse([id], f3)],
    ["definirFournisseurEnMasse vide", (id) => C.definirFournisseurEnMasse([id], "")],
    ["ajouterFournisseurEnMasse", (id) => C.ajouterFournisseurEnMasse([id], f3)],
    ["retirerFournisseurEnMasse", (id) => C.retirerFournisseurEnMasse([id], f1)],
    ["definirFournisseurHabituel", (id) => C.definirFournisseurHabituel(id, f2)],
    ["ajouterFournisseursArticle", (id) => C.ajouterFournisseursArticle(id, [f3])],
    ["retirerFournisseursArticle", (id) => C.retirerFournisseursArticle(id, [f1, f2])],
  ];
  for (const [nom, geste] of cas) it(nom, async () => {
    const a = (await prisma.articleStock.create({ data: { designation: "Art " + nom, domaine: "NOURRITURE", fournisseurId: f1 } })).id;
    await prisma.articleFournisseur.createMany({ data: [{ articleId: a, fournisseurId: f1, habituel: true }, { articleId: a, fournisseurId: f2 }] });
    const avant = await snap();
    const r = (await geste(a)) as { erreur?: string; proposition?: boolean } | undefined;
    expect(r?.erreur).toBeUndefined();
    expect(await snap()).toEqual(avant);
    expect(await prisma.demandeValidationStock.count({ where: { statut: "EN_ATTENTE" } })).toBe(1);
    expect(r).toMatchObject({ proposition: true });
  }, 60_000);
});
