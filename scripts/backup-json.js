// Backup logique JSON de toutes les tables du schéma `public` via `pg` (pg_dump indisponible).
// Filet de sécurité avant migration. Usage : node scripts/backup-json.js
// Écrit backups/backup_<timestamp>.json.gz + affiche le nombre de lignes par table.
require("dotenv/config");
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

async function main() {
  const conn = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("DIRECT_URL / DATABASE_URL absent");
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'
     ORDER BY table_name`
  );

  const dump = { generatedAt: new Date().toISOString(), schema: "public", tables: {} };
  const counts = {};
  for (const { table_name } of tables) {
    const { rows } = await client.query(`SELECT * FROM "public"."${table_name}"`);
    dump.tables[table_name] = rows;
    counts[table_name] = rows.length;
  }
  await client.end();

  const dir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `backup_${ts}.json.gz`);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(dump)));
  fs.writeFileSync(file, gz);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log("Tables:", tables.length, "| Lignes totales:", total);
  console.log(JSON.stringify(counts, null, 0));
  console.log("Écrit:", file, "(" + (gz.length / 1024).toFixed(1) + " Ko)");
}
main().catch((e) => { console.error("ÉCHEC BACKUP:", e.message); process.exit(1); });
