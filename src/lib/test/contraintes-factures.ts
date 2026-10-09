import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

/**
 * Les contraintes CHECK de la migration « factures en francs » (20261009120000_factures_francs),
 * LUES dans son migration.sql : les bases de test construites par `prisma db push` ne les ont pas
 * (Prisma ne connaît pas les CHECK). Les tests d'intégration qui écrivent des factures en francs les
 * posent pour que chaque écriture soit jugée par la base comme en production. Si la migration
 * change, ces tests changent avec elle.
 */
export const SQL_CONTRAINTES_FACTURES: string[] = (() => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "..", "prisma", "migrations", "20261009120000_factures_francs", "migration.sql"), "utf8");
  const sansCommentaires = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return sansCommentaires.split(";").map((s) => s.trim()).filter((s) => /ADD CONSTRAINT/.test(s));
})();

export async function poserContraintesFactures(prisma: PrismaClient): Promise<void> {
  if (SQL_CONTRAINTES_FACTURES.length !== 3) throw new Error(`Contraintes des factures en francs introuvables (${SQL_CONTRAINTES_FACTURES.length} au lieu de 3).`);
  for (const s of SQL_CONTRAINTES_FACTURES) await prisma.$executeRawUnsafe(s);
}
