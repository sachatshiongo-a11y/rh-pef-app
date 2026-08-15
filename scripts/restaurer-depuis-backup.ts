/**
 * Restaure une base VIDE (schéma déjà à jour, `npx prisma migrate deploy`) à partir d'une
 * sauvegarde JSON produite par `scripts/backup-json.ts`. Permet de recréer toutes les données
 * (y compris les comptes de connexion) dans un nouveau projet Supabase — utile si l'ancien projet
 * a dû être supprimé avant d'en créer un nouveau.
 *
 * ⚠️ Ce script ÉCRIT (INSERT) dans la base visée par `NOUVEAU_DIRECT_URL`. Il ne doit JAMAIS
 * viser la production : `NOUVEAU_DIRECT_URL` est une variable D'ENVIRONNEMENT SÉPARÉE de
 * `DATABASE_URL`/`DIRECT_URL` (celles du `.env` du dépôt, qui pointent la production) et le
 * script refuse de tourner si elle leur est identique (cf. `verifierPasProduction`).
 *
 * Format attendu (celui écrit par `backup-json.ts` depuis le 2026-08) :
 *   { exportedAt, meta: { totalRows, tablesIgnorees }, models: { User: [...], ... },
 *     auth: { users: [...], identities: [...] } }
 * L'ANCIEN format (plat : `{ "User": [...], "auth.users": [...] }`) n'est PLUS reconnu et fait
 * REFUSER la restauration — mieux vaut un refus net qu'une restauration de zéro ligne en silence
 * (c'est précisément le défaut corrigé ici : avant, `dump["User"]` valait `undefined` sur un
 * fichier au nouveau format, et `?? []` transformait ça en restauration silencieuse de rien).
 *
 * Usage :
 *   NOUVEAU_DIRECT_URL="postgresql://..." \
 *     npx tsx scripts/restaurer-depuis-backup.ts backups/rh-pef_2026-08-15-21-00.json
 */
import "dotenv/config";
import { Client } from "pg";
import fs from "node:fs";

// Ordre d'insertion = parents avant enfants (respecte les clés étrangères).
export const ORDRE = [
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

export type DumpValide = {
  exportedAt?: string;
  meta?: { totalRows?: number; tablesIgnorees?: unknown[] };
  models: Record<string, Record<string, unknown>[]>;
  auth?: { users?: Record<string, unknown>[]; identities?: Record<string, unknown>[] };
};

/**
 * REFUSE la restauration si le fichier n'est pas au format actuel — jamais de restauration
 * silencieuse de zéro ligne. Deux cas rejetés explicitement : l'ANCIEN format plat (clés de
 * modèles au premier niveau, ex. `User`/`auth.users`) et un fichier au bon format mais VIDE
 * (`models` absent ou sans aucune table).
 */
export function validerFormatDump(dump: unknown): asserts dump is DumpValide {
  if (!dump || typeof dump !== "object" || Array.isArray(dump)) {
    throw new Error("Format de sauvegarde non reconnu : le fichier n'est pas un objet JSON.");
  }
  const d = dump as Record<string, unknown>;
  const indicesAncienFormat = ["User", "Config", "Employee", "auth.users"].filter((k) => k in d);
  if (!("models" in d) || indicesAncienFormat.length > 0) {
    throw new Error(
      `Format de sauvegarde non reconnu — restauration REFUSÉE (jamais une restauration silencieuse de zéro ligne). ` +
        `Ce fichier ressemble à l'ANCIEN format plat (clés au premier niveau : ${
          indicesAncienFormat.join(", ") || "clé `models` absente"
        }) ; le format attendu range les modèles sous une clé \`models\` et les comptes sous \`auth\`. ` +
        `Ce script ne sait PAS convertir l'ancien format — il faut soit régénérer la sauvegarde avec la version actuelle de backup-json.ts, soit adapter ce fichier à la main.`
    );
  }
  if (typeof d.models !== "object" || d.models === null || Array.isArray(d.models)) {
    throw new Error("Format de sauvegarde non reconnu : `models` n'est pas un objet de tables.");
  }
  if (Object.keys(d.models as object).length === 0) {
    throw new Error(
      "Sauvegarde REFUSÉE : `models` ne contient AUCUNE table. Un fichier de sauvegarde vide n'est jamais restauré silencieusement."
    );
  }
}

export type CompteTable = { lues: number; inserees: number };

async function insererLignes(dst: Client, table: string, rows: Record<string, unknown>[]): Promise<CompteTable> {
  if (!rows || rows.length === 0) return { lues: 0, inserees: 0 };
  const colonnes = Object.keys(rows[0]);
  const listeCols = colonnes.map((c) => `"${c}"`).join(", ");
  let inserees = 0;
  for (const row of rows) {
    const valeurs = colonnes.map((c) => row[c]);
    const placeholders = colonnes.map((_, i) => `$${i + 1}`).join(", ");
    const res = await dst.query(
      `INSERT INTO "${table}" (${listeCols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      valeurs
    );
    inserees += res.rowCount ?? 0;
  }
  return { lues: rows.length, inserees };
}

async function restaurerAuthUsers(dst: Client, users: Record<string, unknown>[]): Promise<CompteTable> {
  let inserees = 0;
  for (const u of users) {
    const res = await dst.query(
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
    inserees += res.rowCount ?? 0;
  }

  // GoTrue lit ces colonnes de jetons comme du texte : elles doivent être '' et non NULL,
  // sinon toute requête auth échoue en 500 "Database error finding users".
  if (users.length > 0) {
    await dst.query(`UPDATE auth.users SET
        confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change = COALESCE(email_change, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        phone_change = COALESCE(phone_change, ''),
        phone_change_token = COALESCE(phone_change_token, ''),
        reauthentication_token = COALESCE(reauthentication_token, '')`);
  }
  return { lues: users.length, inserees };
}

/**
 * Supabase exige une ligne `auth.identities` (provider 'email') EN PLUS de `auth.users` pour
 * autoriser la connexion par mot de passe. Depuis l'ajout du schéma `auth` à la sauvegarde, les
 * identités RÉELLEMENT exportées sont réinjectées telles quelles (préserve provider/horodatage
 * d'origine, couvre aussi d'éventuels providers autres que 'email'). En repli — sauvegarde d'un
 * ancien format qui n'exportait pas encore `auth.identities`, ou compte sans identité exportée —
 * une identité 'email' minimale est fabriquée, comme avant.
 */
async function restaurerAuthIdentities(
  dst: Client,
  users: Record<string, unknown>[],
  identitesExportees: Record<string, unknown>[]
): Promise<CompteTable> {
  const parUtilisateur = new Map<string, Record<string, unknown>[]>();
  for (const idt of identitesExportees) {
    const uid = String(idt.user_id);
    const liste = parUtilisateur.get(uid) ?? [];
    liste.push(idt);
    parUtilisateur.set(uid, liste);
  }

  let inserees = 0;
  for (const u of users) {
    const exportees = parUtilisateur.get(String(u.id));
    if (exportees && exportees.length > 0) {
      for (const idt of exportees) {
        const res = await dst.query(
          `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
           SELECT $1, $2, $3::jsonb, $4, $5, $6, $7
           WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = $2 AND provider = $4)`,
          [
            idt.provider_id, u.id, JSON.stringify(idt.identity_data ?? {}), idt.provider,
            idt.last_sign_in_at ?? null, idt.created_at ?? null, idt.updated_at ?? null,
          ]
        );
        inserees += res.rowCount ?? 0;
      }
    } else {
      const res = await dst.query(
        `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         SELECT $1, $2, $3::jsonb, 'email', now(), now(), now()
         WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = $2 AND provider = 'email')`,
        [u.id, u.id, JSON.stringify({ sub: u.id, email: u.email, email_verified: true, phone_verified: false })]
      );
      inserees += res.rowCount ?? 0;
    }
  }
  return { lues: identitesExportees.length, inserees };
}

export type ResultatRestauration = {
  authUsers: CompteTable;
  authIdentities: CompteTable;
  tables: Record<string, CompteTable>;
  tablesNonPlacees: string[];
  tablesAbsentesDuFichier: string[];
};

/**
 * Exécute la restauration sur une connexion `dst` DÉJÀ OUVERTE (le caller gère connexion/fin, ce
 * qui rend la fonction testable sur un Postgres éphémère sans dupliquer la logique CLI).
 * `dump` doit avoir déjà passé `validerFormatDump`.
 */
export async function executerRestauration(dst: Client, dump: DumpValide): Promise<ResultatRestauration> {
  const authUsersSource = dump.auth?.users ?? [];
  const authIdentitiesSource = dump.auth?.identities ?? [];

  const authUsers = await restaurerAuthUsers(dst, authUsersSource);
  console.log(`  auth.users: ${authUsers.lues} lue(s) / ${authUsers.inserees} insérée(s)`);
  const authIdentities = await restaurerAuthIdentities(dst, authUsersSource, authIdentitiesSource);
  console.log(`  auth.identities: ${authIdentities.lues} lue(s) / ${authIdentities.inserees} insérée(s)`);

  const tables: Record<string, CompteTable> = {};
  for (const table of ORDRE) {
    const compte = await insererLignes(dst, table, dump.models[table] ?? []);
    tables[table] = compte;
    console.log(`  ${table}: ${compte.lues} lue(s) / ${compte.inserees} insérée(s)`);
  }

  // Tables présentes dans le fichier mais que ce script ne sait pas placer (absentes de ORDRE) —
  // AVANT, elles étaient silencieusement ignorées : on les nomme explicitement.
  const tablesNonPlacees = Object.keys(dump.models).filter((t) => !ORDRE.includes(t));
  // Tables attendues (ORDRE) totalement absentes du fichier — distinct d'une table présente à 0
  // ligne : ça peut signaler un modèle oublié dans backup-json.ts (déjà arrivé une fois).
  const tablesAbsentesDuFichier = ORDRE.filter((t) => !(t in dump.models));

  if (tablesNonPlacees.length > 0) {
    console.warn(
      `\n/!\\ ${tablesNonPlacees.length} table(s) du fichier NON PLACÉE(S) (absentes de ORDRE, donc PAS restaurées) : ${tablesNonPlacees.join(", ")}`
    );
  }
  if (tablesAbsentesDuFichier.length > 0) {
    console.warn(
      `\n/!\\ ${tablesAbsentesDuFichier.length} table(s) attendue(s) ABSENTE(S) du fichier (0 ligne, pas juste vide — vérifier que la sauvegarde n'a pas oublié un modèle) : ${tablesAbsentesDuFichier.join(", ")}`
    );
  }

  // Réaligne les séquences auto-incrémentées.
  for (const t of ["ExerciceFiscal", "ParametreLegal", "TrancheIprCDF", "JourFerie"]) {
    await dst
      .query(
        `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1), true)`
      )
      .catch(() => {});
  }

  return { authUsers, authIdentities, tables, tablesNonPlacees, tablesAbsentesDuFichier };
}

/**
 * Garde-fou : `NOUVEAU_DIRECT_URL` (la cible, sur laquelle on ÉCRIT) ne doit JAMAIS être
 * identique à `DATABASE_URL`/`DIRECT_URL` (celles du `.env` du dépôt, qui pointent la
 * PRODUCTION). Une simple faute de copier-coller de variable ne doit pas suffire à écraser la
 * production.
 */
export function verifierPasProduction(
  nouveauUrl: string,
  env: { DATABASE_URL?: string; DIRECT_URL?: string }
): void {
  const cibles = [env.DATABASE_URL, env.DIRECT_URL].filter((v): v is string => !!v && v.length > 0);
  if (cibles.includes(nouveauUrl)) {
    throw new Error(
      "REFUS : NOUVEAU_DIRECT_URL est identique à DATABASE_URL ou DIRECT_URL du .env (production). " +
        "Ce script ÉCRIT dans la base visée — il ne doit JAMAIS pointer la production."
    );
  }
}

// Exécution directe uniquement (jamais lors d'un import par les tests).
if (process.argv[1] && process.argv[1].endsWith("restaurer-depuis-backup.ts")) {
  const NOUVEAU = process.env.NOUVEAU_DIRECT_URL;
  const chemin = process.argv[2];

  if (!NOUVEAU || !chemin) {
    console.error(
      'Usage : NOUVEAU_DIRECT_URL="..." npx tsx scripts/restaurer-depuis-backup.ts <fichier-backup.json>'
    );
    process.exit(1);
  }

  (async () => {
    verifierPasProduction(NOUVEAU, { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

    const dump: unknown = JSON.parse(fs.readFileSync(chemin, "utf-8"));
    validerFormatDump(dump);

    const dst = new Client({ connectionString: NOUVEAU });
    await dst.connect();
    try {
      const resultat = await executerRestauration(dst, dump);
      const totalInserees =
        resultat.authUsers.inserees +
        resultat.authIdentities.inserees +
        Object.values(resultat.tables).reduce((s, c) => s + c.inserees, 0);
      console.log(`\n✓ Restauration terminée — ${totalInserees} ligne(s) insérée(s) au total.`);
    } finally {
      await dst.end();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
