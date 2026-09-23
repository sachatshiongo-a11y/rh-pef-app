import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Migration de DONNÉES : pose la date d'effet 202609 sur chaque exercice qui ne l'a pas. Rejouée
// par `migrate deploy` sur une base vide (src/lib/migrations.integration.test.ts), elle n'insère
// rien et n'y prouve rien : c'est ici, sur des exercices existants, qu'on vérifie qu'elle pose la
// bonne valeur, qu'elle n'écrase jamais un réglage de l'ADMIN et qu'un 2e passage ne crée aucun
// doublon. SQL lu dans migration.sql, jamais recopié.
const SQL = fs.readFileSync(path.join(__dirname, "migration.sql"), "utf8");
const CLE = "paie_reference_planning_depuis";

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let ex: Record<number, number>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  ex = {};
  for (const annee of [2025, 2026, 2027]) {
    ex[annee] = (await prisma.exerciceFiscal.create({ data: { annee, actif: annee === 2026 } })).id;
  }
  // 2027 : l'ADMIN a déjà réglé la date (autre valeur) — la migration ne doit pas y toucher.
  await prisma.parametreLegal.create({ data: { exerciceId: ex[2027], cle: CLE, valeur: 202701, unite: "AAAAMM", libelle: "réglé par l'ADMIN", statutValidation: "VALIDE" } });
}, 120_000);

afterAll(async () => { await fermer?.(); });

const lire = () => prisma.parametreLegal.findMany({ where: { cle: CLE }, orderBy: { exerciceId: "asc" } });

describe("migration param_reference_planning", () => {
  it("pose 202609 (AAAAMM, À VALIDER) sur chaque exercice qui ne l'a pas, sans écraser un réglage", async () => {
    await prisma.$executeRawUnsafe(SQL);
    const p = await lire();
    expect(p.map((x) => [x.exerciceId, Number(x.valeur), x.statutValidation])).toEqual([
      [ex[2025], 202609, "A_VALIDER"],
      [ex[2026], 202609, "A_VALIDER"],
      [ex[2027], 202701, "VALIDE"],
    ]);
    const pose = p.find((x) => x.exerciceId === ex[2026])!;
    expect(pose).toMatchObject({ unite: "AAAAMM", source: "Décision Direction 2026-09-23" });
    expect(pose.libelle).toContain("heures planifiées");
  });

  it("rejouée, ne crée aucun doublon et ne change rien", async () => {
    const avant = await lire();
    await prisma.$executeRawUnsafe(SQL);
    expect(await lire()).toEqual(avant);
  });
});
