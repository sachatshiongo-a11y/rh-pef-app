/**
 * Sauvegarde complète locale de la base (données métier + comptes de connexion) en JSON.
 * À lancer avant toute opération risquée (migration, suppression de projet...).
 *
 * Usage : npx tsx scripts/sauvegarde-locale.ts
 * Sortie : backups/backup-YYYY-MM-DD-HHmm.json (dossier ignoré par git)
 */
import "dotenv/config";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";

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

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  const dump: Record<string, unknown[]> = {};
  let total = 0;

  for (const table of TABLES_PUBLIC) {
    const { rows } = await client.query(`SELECT * FROM "${table}"`);
    dump[table] = rows;
    total += rows.length;
    console.log(`  ${table}: ${rows.length}`);
  }

  const { rows: authUsers } = await client.query(
    `SELECT id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
            raw_app_meta_data, raw_user_meta_data, aud, role
     FROM auth.users`
  );
  dump["auth.users"] = authUsers;
  total += authUsers.length;
  console.log(`  auth.users: ${authUsers.length}`);

  await client.end();

  const dossier = path.join(process.cwd(), "backups");
  fs.mkdirSync(dossier, { recursive: true });
  const horodatage = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const fichier = path.join(dossier, `backup-${horodatage}.json`);
  fs.writeFileSync(fichier, JSON.stringify(dump, null, 1));

  console.log(`\nSauvegarde : ${fichier} (${total} lignes, ${Math.round(fs.statSync(fichier).size / 1024)} Ko)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
