import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le Postgres embarqué applique le SCHÉMA (prisma db push), pas les migrations : la table existe,
// vide. Ce test exécute l'INSERT lu dans migration.sql — jamais recopié — et vérifie qu'il reprend
// exactement les contrats acceptés au clic, sans tracé.
const SQL = fs.readFileSync(path.join(__dirname, "migration.sql"), "utf8");
const INSERT = SQL.slice(SQL.indexOf('INSERT INTO "public"."SignatureElectronique"'));

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  const emp = await prisma.employee.create({
    data: {
      matricule: "SG01-PEF", nom: "Test Signature", sexe: "F", etatCivil: "Célibataire", poste: "Test",
      secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 200, dateEmbauche: new Date("2025-01-01"), contrat: "CDD",
    },
  });
  const base = { employeeId: emp.id, type: "CDD" as const, dateDebut: new Date("2026-01-01"), salaireMensuel: 200, poste: "Test" };
  await prisma.contrat.create({ data: { ...base, accepteLe: new Date("2026-07-20T09:40:00Z") } });
  await prisma.contrat.create({ data: { ...base } }); // jamais accepté
}, 120_000);

afterAll(async () => { await fermer(); });

describe("migration signature_electronique", () => {
  it("la migration contient bien l'INSERT de reprise", () => {
    expect(INSERT).toContain('FROM "public"."Contrat"');
  });

  it("reprend les contrats acceptés au clic, sans tracé, à leur date — et eux seuls", async () => {
    await prisma.$executeRawUnsafe(INSERT);
    const sigs = await prisma.signatureElectronique.findMany({
      select: { cible: true, traceUrl: true, mode: true, signeLe: true, empreinte: true },
    });
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ cible: "CONTRAT", traceUrl: null, mode: "ESPACE_SALARIE", empreinte: "" });
    expect(sigs[0].signeLe.toISOString()).toBe("2026-07-20T09:40:00.000Z");
  });
});
