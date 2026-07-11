import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Démarre un Postgres ÉPHÉMÈRE en local (aucun Docker, aucun contact avec Supabase/prod),
 * applique le schéma Prisma (public + stock) via `prisma db push`, et renvoie un client Prisma
 * branché dessus. Tout est jeté par `fermer()`. Réservé aux tests d'intégration.
 */
export async function creerBaseTest(): Promise<{ prisma: PrismaClient; fermer: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pef-test-"));
  const port = 55000 + Math.floor(Math.random() * 4000); // évite les collisions entre fichiers de test
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("testdb");
  const url = `postgresql://postgres:postgres@localhost:${port}/testdb`;
  execSync(`npx prisma db push --url "${url}" --accept-data-loss`, { stdio: "ignore" });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const fermer = async () => {
    await prisma.$disconnect();
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { prisma, fermer };
}
