/**
 * Restaure une base VIDE à partir d'une sauvegarde JSON (scripts/sauvegarde-locale.ts).
 * Permet de recréer toutes les données (y compris les comptes de connexion) dans un nouveau
 * projet Supabase — utile si l'ancien projet a dû être supprimé avant d'en créer un nouveau.
 *
 * Prérequis : le schéma du nouveau projet est déjà à jour (npx prisma migrate deploy).
 *
 * Usage :
 *   NOUVEAU_DIRECT_URL="postgresql://..." \
 *     npx tsx scripts/restaurer-depuis-backup.ts backups/backup-2026-07-03-0607.json
 */
import "dotenv/config";
import { Client } from "pg";
import fs from "node:fs";

const NOUVEAU = process.env.NOUVEAU_DIRECT_URL;
const chemin = process.argv[2];

if (!NOUVEAU || !chemin) {
  console.error(
    'Usage : NOUVEAU_DIRECT_URL="..." npx tsx scripts/restaurer-depuis-backup.ts <fichier-backup.json>'
  );
  process.exit(1);
}

// Ordre d'insertion = parents avant enfants (respecte les clés étrangères).
const ORDRE = [
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
  "DeclarationTaxe",
];

async function insererLignes(dst: Client, table: string, rows: Record<string, unknown>[]) {
  if (!rows || rows.length === 0) {
    console.log(`  ${table}: 0`);
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
  console.log(`  ${table}: ${rows.length}`);
}

async function main() {
  const dump = JSON.parse(fs.readFileSync(chemin, "utf-8")) as Record<string, Record<string, unknown>[]>;
  const dst = new Client({ connectionString: NOUVEAU });
  await dst.connect();

  // Comptes de connexion (auth.users) — préserve id + mot de passe hashé.
  const authUsers = dump["auth.users"] ?? [];
  for (const u of authUsers) {
    await dst.query(
      `INSERT INTO auth.users
        (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, aud, role)
       VALUES ('00000000-0000-0000-0000-000000000000', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.created_at, u.updated_at,
        u.raw_app_meta_data, u.raw_user_meta_data, u.aud ?? "authenticated", u.role ?? "authenticated",
      ]
    );
  }
  console.log(`  auth.users: ${authUsers.length}`);

  // GoTrue lit ces colonnes de jetons comme du texte : elles doivent être '' et non NULL,
  // sinon toute requête auth échoue en 500 "Database error finding users".
  await dst.query(`UPDATE auth.users SET
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change = COALESCE(email_change, ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      phone_change = COALESCE(phone_change, ''),
      phone_change_token = COALESCE(phone_change_token, ''),
      reauthentication_token = COALESCE(reauthentication_token, '')`);

  // Supabase exige une ligne auth.identities (provider 'email') EN PLUS de auth.users pour
  // autoriser la connexion par mot de passe. La sauvegarde ne la contient pas → on la recrée.
  for (const u of authUsers) {
    await dst.query(
      `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       SELECT $1, $2, $3::jsonb, 'email', now(), now(), now()
       WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = $2 AND provider = 'email')`,
      [u.id, u.id, JSON.stringify({ sub: u.id, email: u.email, email_verified: true, phone_verified: false })]
    );
  }
  console.log(`  auth.identities (email): assurées pour ${authUsers.length} compte(s)`);

  for (const table of ORDRE) {
    await insererLignes(dst, table, dump[table] ?? []);
  }

  // Réaligne les séquences auto-incrémentées.
  for (const t of ["ExerciceFiscal", "ParametreLegal", "TrancheIprCDF", "JourFerie"]) {
    await dst
      .query(
        `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1), true)`
      )
      .catch(() => {});
  }

  await dst.end();
  console.log("Restauration terminée.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
