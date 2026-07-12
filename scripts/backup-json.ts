/**
 * Sauvegarde logique de secours SANS pg_dump : exporte toutes les tables (Prisma) en JSON.
 * Filet de sécurité immédiat tant que pg_dump/libpq n'est pas installé et que Supabase reste Free.
 * ⚠️ Contient TOUTES les données de paie (PII, salaires) — à conserver chiffré, hors cloud public.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }) });

const replacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString()
  : v instanceof Buffer ? v.toString("base64")
  : v;

(async () => {
  const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const dir = join(homedir(), "Sauvegardes-RH-PEF");
  mkdirSync(dir, { recursive: true });
  const out: Record<string, unknown[]> = {};
  let totalRows = 0;
  for (const name of models) {
    const delegate = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<unknown[]> }>)[
      name.charAt(0).toLowerCase() + name.slice(1)
    ];
    if (!delegate?.findMany) continue;
    const rows = await delegate.findMany({});
    out[name] = rows;
    totalRows += rows.length;
    console.log(`  ${name}: ${rows.length}`);
  }
  const file = join(dir, `rh-pef_${stamp}.json`);
  writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), models: out }, replacer, 0));
  const { size } = await import("fs").then((fs) => fs.statSync(file));
  console.log(`\n✓ ${models.length} tables, ${totalRows} lignes → ${file} (${(size / 1024 / 1024).toFixed(1)} Mo)`);
  await prisma.$disconnect();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
