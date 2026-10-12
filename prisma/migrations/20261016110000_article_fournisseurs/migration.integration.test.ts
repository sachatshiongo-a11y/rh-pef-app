import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Migration « plusieurs fournisseurs par article » : le SQL de la migration, joué sur une base qui porte déjà des
// données D'AVANT (fournisseur de la fiche article, factures, achats directs, bons), doit
//  - recopier le fournisseur de chaque fiche comme fournisseur HABITUEL ;
//  - ajouter les fournisseurs déjà VUS dans l'historique (factures rattachées à un article, achats directs en
//    entrée, bons engagés) sans en inventer un habituel et sans rien compter deux fois ;
//  - être IDEMPOTENTE (un 2e passage n'ajoute rien) ; refuser un 2e habituel et un couple en double.
// (La base de test est construite par `db push` : la table existe, vide ; le SQL ajoute l'index partiel, la RLS et la reprise.)
const SQL = fs.readFileSync(path.join(__dirname, "migration.sql"), "utf8");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let pg: Client;
let ids: Record<string, string> = {};

const liens = async (articleId: string) => (await pg.query(`SELECT "fournisseurId" AS f, habituel, source FROM stock."ArticleFournisseur" WHERE "articleId" = $1 ORDER BY "fournisseurId"`, [articleId])).rows as { f: string; habituel: boolean; source: string }[];

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma;
  fermer = db.fermer;
  pg = new Client({ connectionString: db.url });
  await pg.connect();
  const [f1, f2, f3] = await Promise.all(["F1", "F2", "F3"].map((nom) => prisma.fournisseur.create({ data: { nom } })));
  const art = (designation: string, fournisseurId?: string) => prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", ...(fournisseurId ? { fournisseurId } : {}) } });
  const aFiche = await art("Fiche F1", f1.id);
  const aHisto = await art("Historique");
  const aDouble = await art("Habituel et vu", f1.id);
  const aAucun = await art("Rien");
  // Factures (F2 sur aHisto ; F1 sur aDouble : déjà habituel) ; une ligne libre (sans article) et une facture sans fournisseur : ignorées.
  await prisma.factureFournisseur.create({ data: { fournisseurId: f2.id, fournisseurNom: "F2", mois: 9, annee: 2026, date: new Date("2026-09-05"), montantUSD: 10, lignes: { create: [{ articleId: aHisto.id, designation: "x", quantite: 1, prixUnitaireUSD: 10 }, { designation: "libre", quantite: 1, prixUnitaireUSD: 1 }] } } });
  await prisma.factureFournisseur.create({ data: { fournisseurId: f1.id, fournisseurNom: "F1", mois: 9, annee: 2026, date: new Date("2026-09-06"), montantUSD: 10, lignes: { create: [{ articleId: aDouble.id, designation: "x", quantite: 1, prixUnitaireUSD: 10 }] } } });
  await prisma.factureFournisseur.create({ data: { fournisseurNom: "Sans fiche", mois: 9, annee: 2026, montantUSD: 5, lignes: { create: [{ articleId: aAucun.id, designation: "x", quantite: 1, prixUnitaireUSD: 5 }] } } });
  // Achat direct (entrée avec fournisseur) : F3 sur aHisto ; une SORTIE avec fournisseur n'est pas un achat.
  await prisma.mouvementStock.create({ data: { articleId: aHisto.id, type: "ENTREE", quantite: 1, fournisseurId: f3.id } });
  await prisma.mouvementStock.create({ data: { articleId: aAucun.id, type: "SORTIE", quantite: 1, fournisseurId: f3.id } });
  // Bons : validé (F1 sur aHisto) compte ; brouillon et annulé (F2 sur aAucun) ne comptent pas.
  const bon = (n: number, statut: "VALIDE" | "BROUILLON" | "ANNULE", fournisseurId: string, articleId: string) =>
    prisma.bonDeCommande.create({ data: { numero: `00${n}/PEF/T/OCT/26`, sequence: n, annee: 2026, mois: 10, statut, fournisseurId, lignes: { create: [{ articleId, designation: "x", quantite: 1 }] } } });
  await bon(1, "VALIDE", f1.id, aHisto.id);
  await bon(2, "BROUILLON", f2.id, aAucun.id);
  await bon(3, "ANNULE", f2.id, aAucun.id);
  ids = { f1: f1.id, f2: f2.id, f3: f3.id, aFiche: aFiche.id, aHisto: aHisto.id, aDouble: aDouble.id, aAucun: aAucun.id };
  await pg.query(SQL); // la migration
}, 180_000);
afterAll(async () => { await pg?.end(); await fermer?.(); });

describe("migration 20261016110000_article_fournisseurs", () => {
  it("le fournisseur de la fiche devient l'HABITUEL", async () => {
    expect(await liens(ids.aFiche)).toEqual([{ f: ids.f1, habituel: true, source: "HISTORIQUE" }]);
  });

  it("les fournisseurs déjà vus (facture, achat direct, bon engagé) sont ajoutés, sans habituel inventé", async () => {
    const l = await liens(ids.aHisto);
    expect(l.map((x) => x.f).sort()).toEqual([ids.f1, ids.f2, ids.f3].sort());
    expect(l.some((x) => x.habituel)).toBe(false);
    const col = await pg.query(`SELECT "fournisseurId" AS f FROM stock."ArticleStock" WHERE id = $1`, [ids.aHisto]);
    expect(col.rows[0].f).toBeNull(); // la copie de compatibilité n'est pas inventée non plus
  });

  it("l'habituel déjà vu dans une facture reste UN seul lien, habituel", async () => {
    expect(await liens(ids.aDouble)).toEqual([{ f: ids.f1, habituel: true, source: "HISTORIQUE" }]);
  });

  it("une facture sans fournisseur, une sortie, un bon brouillon ou annulé n'ajoutent rien", async () => {
    expect(await liens(ids.aAucun)).toEqual([]);
  });

  it("idempotente : un 2e passage n'ajoute ni ne change rien", async () => {
    const avant = (await pg.query(`SELECT "articleId", "fournisseurId", habituel, source FROM stock."ArticleFournisseur" ORDER BY 1, 2`)).rows;
    await pg.query(SQL);
    const apres = (await pg.query(`SELECT "articleId", "fournisseurId", habituel, source FROM stock."ArticleFournisseur" ORDER BY 1, 2`)).rows;
    expect(apres).toEqual(avant);
    expect(avant).toHaveLength(1 + 3 + 1);
  });

  it("la base refuse un 2e habituel pour un article et un couple en double", async () => {
    const ins = (a: string, f: string, h: boolean) => pg.query(`INSERT INTO stock."ArticleFournisseur" (id, "articleId", "fournisseurId", habituel, "updatedAt") VALUES (gen_random_uuid()::text, $1, $2, $3, now())`, [a, f, h]);
    await expect(ins(ids.aFiche, ids.f2, true)).rejects.toThrow(/ArticleFournisseur_un_habituel_key/);
    await expect(ins(ids.aFiche, ids.f1, false)).rejects.toThrow(/ArticleFournisseur_articleId_fournisseurId_key/);
    await ins(ids.aFiche, ids.f2, false); // un non-habituel de plus : permis
  });

  it("la RLS est activée sur la table neuve", async () => {
    const r = await pg.query(`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'stock' AND c.relname = 'ArticleFournisseur'`);
    expect(r.rows[0]).toEqual({ rls: true, force: false });
  });

  it("supprimer un fournisseur ou un article emporte ses liens (cascade)", async () => {
    await prisma.articleStock.delete({ where: { id: ids.aHisto } });
    expect((await pg.query(`SELECT 1 FROM stock."ArticleFournisseur" WHERE "articleId" = $1`, [ids.aHisto])).rowCount).toBe(0);
    await prisma.fournisseur.delete({ where: { id: ids.f2 } });
    expect((await pg.query(`SELECT 1 FROM stock."ArticleFournisseur" WHERE "fournisseurId" = $1`, [ids.f2])).rowCount).toBe(0);
  });
});
