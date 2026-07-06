import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// DIRECT_URL = connexion directe Postgres (port 5432), utilisée par Prisma Migrate.
// L'application, elle, se connecte via DATABASE_URL (pooler, port 6543) — voir src/lib/prisma.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DIRECT_URL"),
  },
});
