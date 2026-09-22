import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le UPDATE de la migration coche « compte dans le solde » sur les types dont le nom contient
// « annuel », et SEULEMENT ceux-là. Lu dans migration.sql : si quelqu'un modifie la migration,
// ce test change avec elle.
const SQL = fs.readFileSync(path.join(__dirname, "migration.sql"), "utf8");
const UPDATE = SQL.split("\n").find((l) => l.trim().startsWith("UPDATE "));

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  await prisma.typeConge.createMany({
    data: [
      { nom: "Congé annuel", ordre: 1, systeme: true },
      { nom: "Congé maladie", ordre: 2 },
      { nom: "Repos compensateur", ordre: 3 },
      { nom: "CONGÉ ANNUEL ANTICIPÉ", ordre: 4 },
    ],
  });
}, 120_000);

afterAll(async () => { await fermer(); });

describe("migration typeconge_compte_dans_solde", () => {
  it("la migration contient bien un UPDATE", () => {
    expect(UPDATE).toBeDefined();
  });
  it("ne coche que les types dont le nom contient « annuel », quelle que soit la casse", async () => {
    await prisma.$executeRawUnsafe(UPDATE!);
    const types = await prisma.typeConge.findMany({ orderBy: { ordre: "asc" }, select: { nom: true, compteDansSolde: true } });
    expect(types).toEqual([
      { nom: "Congé annuel", compteDansSolde: true },
      { nom: "Congé maladie", compteDansSolde: false },
      { nom: "Repos compensateur", compteDansSolde: false },
      { nom: "CONGÉ ANNUEL ANTICIPÉ", compteDansSolde: true },
    ]);
  });
});
