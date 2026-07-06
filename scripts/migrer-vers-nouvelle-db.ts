/**
 * Migration des données de l'ancienne base Supabase (Oregon) vers la nouvelle (Europe).
 *
 * Prérequis :
 *   1. Le nouveau projet Supabase est créé et son schéma est à jour :
 *        DIRECT_URL_NOUVEAU=... npx prisma migrate deploy   (voir docs/MIGRATION-DB.md)
 *   2. Renseigner les deux connexions directes (port 5432) ci-dessous via variables d'env :
 *        ANCIEN_DIRECT_URL = connexion directe de l'ancienne base (celle du .env actuel)
 *        NOUVEAU_DIRECT_URL = connexion directe de la nouvelle base
 *
 * Usage :
 *   ANCIEN_DIRECT_URL="postgresql://..." NOUVEAU_DIRECT_URL="postgresql://..." \
 *     npx tsx scripts/migrer-vers-nouvelle-db.ts
 *
 * Ce script copie les données métier ET les comptes auth (auth.users) en préservant les
 * identifiants, pour que les connexions et toutes les relations (audit, paie...) restent valides.
 */
import "dotenv/config";
import { Client } from "pg";

const ANCIEN = process.env.ANCIEN_DIRECT_URL;
const NOUVEAU = process.env.NOUVEAU_DIRECT_URL;

if (!ANCIEN || !NOUVEAU) {
  console.error("Définir ANCIEN_DIRECT_URL et NOUVEAU_DIRECT_URL.");
  process.exit(1);
}

// Ordre de copie = ordre des dépendances (parents avant enfants).
const TABLES_PUBLIC = [
  "User",
  "Config",
  "ExerciceFiscal",
  "ParametreLegal",
  "TrancheIprCDF",
  "JourFerie",
  "Employee",
  "Contrat",
  "HistoriqueSalaire",
  "DossierDisciplinaire",
  "Evaluation",
  "DocumentEmploye",
  "ImportPointage",
  "Attendance",
  "OvertimeEntry",
  "PayrollRun",
  "PayrollLine",
  "TransitionPaie",
  "VersionBulletin",
  "JournalAudit",
  "LeaveRequest",
];

async function copierTable(src: Client, dst: Client, table: string) {
  const { rows } = await src.query(`SELECT * FROM "${table}"`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 ligne`);
    return;
  }
  const colonnes = Object.keys(rows[0]);
  const listeCols = colonnes.map((c) => `"${c}"`).join(", ");

  for (const row of rows) {
    const valeurs = colonnes.map((c) => row[c]);
    const placeholders = colonnes.map((_, i) => `$${i + 1}`).join(", ");
    await dst.query(
      `INSERT INTO "${table}" (${listeCols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      valeurs
    );
  }
  console.log(`  ${table}: ${rows.length} ligne(s)`);
}

/** Copie les comptes de connexion (auth.users) en préservant id + mot de passe hashé. */
async function copierAuthUsers(src: Client, dst: Client) {
  const { rows } = await src.query(
    `SELECT id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
            raw_app_meta_data, raw_user_meta_data, aud, role
     FROM auth.users`
  );
  for (const u of rows) {
    await dst.query(
      `INSERT INTO auth.users
        (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, aud, role)
       VALUES ('00000000-0000-0000-0000-000000000000', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        u.id,
        u.email,
        u.encrypted_password,
        u.email_confirmed_at,
        u.created_at,
        u.updated_at,
        u.raw_app_meta_data,
        u.raw_user_meta_data,
        u.aud ?? "authenticated",
        u.role ?? "authenticated",
      ]
    );
  }
  console.log(`  auth.users: ${rows.length} compte(s)`);
}

async function main() {
  const src = new Client({ connectionString: ANCIEN });
  const dst = new Client({ connectionString: NOUVEAU });
  await src.connect();
  await dst.connect();

  console.log("Copie des comptes de connexion...");
  await copierAuthUsers(src, dst);

  console.log("Copie des données métier...");
  for (const table of TABLES_PUBLIC) {
    await copierTable(src, dst, table);
  }

  // Réaligne les séquences auto-incrémentées après insertion d'ID explicites.
  const sequencesTables = ["ExerciceFiscal", "ParametreLegal", "TrancheIprCDF", "JourFerie"];
  for (const t of sequencesTables) {
    await dst
      .query(
        `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'),
           COALESCE((SELECT MAX(id) FROM "${t}"), 1), true)`
      )
      .catch(() => {});
  }

  await src.end();
  await dst.end();
  console.log("Migration terminée.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
