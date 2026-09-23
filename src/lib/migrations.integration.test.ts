import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

// Test d'INTÉGRATION — le SEUL test qui rejoue TOUTES les migrations de `prisma/migrations/`, dans
// l'ordre, avec `prisma migrate deploy`.
//
// Pourquoi. Tous les autres tests construisent leur base par `prisma db push` (src/lib/test/db.ts) :
// ils partent du schéma Prisma et ignorent le SQL des migrations (les rares tests rangés dans un
// dossier de migration n'en exécutent qu'un fragment, sur une base « db push »). Or c'est ce SQL, et lui seul, qui
// reconstruit une base réelle (restauration, nouveau client, démonstration). Le 2026-09-23, on a
// mesuré qu'une base reconstruite ainsi laissait 53 tables SANS RLS (Employee, User, PayrollLine,
// tout le schéma `stock`…) et, sur Supabase, les ouvrait aux rôles publics `anon`/`authenticated`
// — alors que la production, corrigée à la main, était fermée. Ce test rejoue les migrations sur
// une base « Supabase neuve » simulée et exige qu'on retombe sur l'état de la production.
//
// POUR L'AVENIR : toute NOUVELLE migration qui crée une table dans `public`, `stock` ou
// `exploitation` sans `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (ou qui accorde un droit à
// anon/authenticated) fait rougir ce test, par construction : il rejoue TOUTES les migrations
// présentes dans le dossier, y compris celles écrites après lui, et vérifie TOUTES les tables.
//
// SÉCURITÉ ABSOLUE — le `.env` de ce dépôt pointe la base de PRODUCTION et `prisma.config.ts` fait
// `import "dotenv/config"`. Ce test ne passe donc JAMAIS par la configuration du dépôt :
//   - il écrit sa PROPRE configuration Prisma dans un dossier temporaire (sans dotenv, URL en dur) ;
//   - il lance Prisma DEPUIS ce dossier temporaire (aucun `.env` à portée) ;
//   - il passe l'URL jetable dans DIRECT_URL ET DATABASE_URL du processus enfant ;
//   - `exigerUrlLocale()` lève AVANT toute commande si l'URL ne vise pas localhost/127.0.0.1.

const RACINE = path.resolve(__dirname, "../..");
const PRISMA_BIN = path.join(RACINE, "node_modules", ".bin", "prisma");
const SCHEMA = path.join(RACINE, "prisma", "schema.prisma");
const MIGRATIONS = path.join(RACINE, "prisma", "migrations");
const SCHEMAS_APP = ["public", "stock", "exploitation"];
const ROLES_PUBLICS = ["anon", "authenticated"];

/** Garde bloquante : lève si l'URL ne vise pas une base locale. Appelée avant CHAQUE commande. */
function exigerUrlLocale(url: string): void {
  if (!/^postgresql:\/\/[^@/]+@(localhost|127\.0\.0\.1):\d+\/[^/?#]+$/.test(url)) {
    throw new Error(`REFUS : URL non locale, le test des migrations ne s'y connectera pas (${url.replace(/:[^:@/]*@/, ":***@")})`);
  }
}

/** Une base jetable : son Postgres embarqué, son dossier, SA configuration Prisma, un client. */
type Base = { pg: EmbeddedPostgres; dir: string; url: string; config: string; client: Client };

async function demarrerBase(): Promise<Base> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pef-migrations-"));
  const port = 55000 + Math.floor(Math.random() * 4000);
  const url = `postgresql://postgres:postgres@localhost:${port}/migdb`;
  exigerUrlLocale(url);

  // Configuration Prisma À PART : aucun import (donc aucun dotenv), URL jetable écrite en dur.
  const config = path.join(dir, "prisma.config.ts");
  fs.writeFileSync(config, `export default ${JSON.stringify({
    schema: SCHEMA,
    migrations: { path: MIGRATIONS },
    datasource: { url },
  }, null, 2)};\n`);

  const pg = new EmbeddedPostgres({ databaseDir: path.join(dir, "data"), user: "postgres", password: "postgres", port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("migdb");
  const client = new Client({ connectionString: url });
  await client.connect();
  return { pg, dir, url, config, client };
}

async function arreterBase(b: Base | undefined): Promise<void> {
  if (!b) return;
  await b.client.end().catch(() => {});
  await b.pg.stop().catch(() => {});
  fs.rmSync(b.dir, { recursive: true, force: true });
}

function prismaSur(b: Base, args: string[]): string {
  exigerUrlLocale(b.url);
  // Environnement minimal : AUCUNE variable héritée ne peut orienter Prisma vers une autre base.
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DIRECT_URL: b.url,
    DATABASE_URL: b.url,
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    CHECKPOINT_DISABLE: "1",
  };
  return execFileSync(PRISMA_BIN, [...args, "--config", b.config], { cwd: b.dir, env: env as NodeJS.ProcessEnv, encoding: "utf8", stdio: "pipe" });
}

async function lignesSur<T>(b: Base, sql: string): Promise<T[]> {
  exigerUrlLocale(b.url);
  return (await b.client.query(sql)).rows as T[];
}

/** Tables de public/stock/exploitation dont la RLS n'est pas « ENABLE sans FORCE ». */
const SQL_TABLES = `
  SELECT format('%I.%I', n.nspname, c.relname) AS nom, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'stock', 'exploitation') AND c.relkind IN ('r', 'p')
  ORDER BY 1`;

let sb: Base; // la base « Supabase neuve » simulée
/** Nom de la première table (ordre alphabétique) d'un schéma ayant une colonne `id`. */
async function premiereTable(schema: string): Promise<string> {
  const r = await lignesSur<{ t: string }>(sb, `
    SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id')
    ORDER BY 1 LIMIT 1`);
  return r[0].t;
}
const prisma = (args: string[]) => prismaSur(sb, args);
const lignes = <T>(sql: string) => lignesSur<T>(sb, sql);

/** Droits DIRECTS d'anon/authenticated sur les objets des schémas de l'application. */
const SQL_DROITS_PUBLICS = `
  WITH roles AS (SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
  SELECT format('%s sur %s %I.%I', r.rolname, CASE c.relkind WHEN 'S' THEN 'séquence' ELSE 'table' END, n.nspname, c.relname) AS droit
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a JOIN roles r ON r.oid = a.grantee
  WHERE n.nspname IN ('public', 'stock', 'exploitation')
  UNION ALL
  SELECT format('%s sur colonne %I.%I.%I', r.rolname, n.nspname, c.relname, att.attname)
  FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace,
       aclexplode(att.attacl) a JOIN roles r ON r.oid = a.grantee
  WHERE n.nspname IN ('public', 'stock', 'exploitation')
  UNION ALL
  SELECT format('%s sur fonction %s', r.rolname, p.oid::regprocedure)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(p.proacl) a JOIN roles r ON r.oid = a.grantee
  WHERE n.nspname IN ('public', 'stock', 'exploitation')
  UNION ALL
  SELECT format('%s sur schéma %I (%s)', r.rolname, n.nspname, a.privilege_type)
  FROM pg_namespace n, aclexplode(n.nspacl) a JOIN roles r ON r.oid = a.grantee
  WHERE n.nspname IN ('stock', 'exploitation')
  ORDER BY 1`;

/** Droits accordés à `role` sur un objet créé APRÈS les migrations (effet des privilèges par défaut). */
const SQL_DROITS_OBJET = (role: string, oidSql: string, colonneAcl: string, catalogue: string) => `
  SELECT a.privilege_type FROM ${catalogue} o, aclexplode(o.${colonneAcl}) a
  WHERE o.oid = ${oidSql} AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = '${role}')
  ORDER BY 1`;

/** État observable après migration — sert à prouver qu'un 2e passage ne change rien. */
const SQL_INSTANTANE = `
  SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'stock', 'exploitation') AND c.relkind IN ('r', 'p', 'S')
  UNION ALL
  SELECT n.nspname, '(défauts ' || d.defaclobjtype::text || ')', NULL, NULL, d.defaclacl::text
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
  UNION ALL
  SELECT nspname, '(schéma)', NULL, NULL, nspacl::text FROM pg_namespace WHERE nspname IN ('public', 'stock', 'exploitation')
  ORDER BY 1, 2`;

beforeAll(async () => {
  sb = await demarrerBase();

  // Simule une base Supabase NEUVE — le scénario dangereux : les rôles publics existent, ont
  // USAGE sur `public` et reçoivent par défaut TOUS les droits sur ce que `postgres` y crée.
  await sb.client.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `);
  // Témoin : la simulation mord-elle ? Une table créée maintenant DOIT être ouverte à anon.
  // Sinon, tous les « aucun droit » ci-dessous seraient vrais pour une mauvaise raison.
  await sb.client.query(`CREATE TABLE public.temoin_simulation (id int)`);
  const temoin = await lignes<{ privilege_type: string }>(
    SQL_DROITS_OBJET("anon", "'public.temoin_simulation'::regclass", "relacl", "pg_class"),
  );
  if (temoin.length === 0) throw new Error("Simulation Supabase inopérante : la table témoin n'accorde rien à anon");
  await sb.client.query(`DROP TABLE public.temoin_simulation`);

  prisma(["migrate", "deploy"]);
}, 600_000);

afterAll(() => arreterBase(sb));

describe("migrations rejouées sur une base Supabase neuve", () => {
  it("refuse toute URL qui ne vise pas une base locale", () => {
    expect(() => exigerUrlLocale("postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres")).toThrow(/REFUS/);
    expect(() => exigerUrlLocale("postgresql://postgres:x@localhost.evil.com:5432/postgres")).toThrow(/REFUS/);
    expect(() => exigerUrlLocale("postgresql://postgres:x@127.0.0.1:5432/db?host=prod.example.com")).toThrow(/REFUS/);
    expect(() => exigerUrlLocale(sb.url)).not.toThrow();
  });

  it("sont TOUTES appliquées, sans échec", async () => {
    const dossiers = fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const appliquees = await lignes<{ migration_name: string }>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1`,
    );
    expect(dossiers.length).toBeGreaterThan(80);
    expect(appliquees.map((m) => m.migration_name)).toEqual(dossiers);
  });

  it("aboutissent exactement au schéma Prisma (migrate diff vide)", () => {
    const diff = prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", SCHEMA, "--script"]);
    const sql = diff.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("--")).join("\n");
    expect(sql).toBe("");
  }, 120_000);

  it("activent la RLS (ENABLE, jamais FORCE) sur TOUTES les tables de public/stock/exploitation", async () => {
    const tables = await lignes<{ nom: string; rls: boolean; force: boolean }>(SQL_TABLES);
    expect(tables.length).toBeGreaterThan(80); // garde contre une requête qui ne verrait rien
    expect(tables.filter((t) => !t.rls).map((t) => t.nom)).toEqual([]);
    expect(tables.filter((t) => t.force).map((t) => t.nom)).toEqual([]);
  });

  it("ne créent aucune politique RLS", async () => {
    const politiques = await lignes<{ p: string }>(`
      SELECT format('%I.%I : %I', schemaname, tablename, policyname) AS p FROM pg_policies
      WHERE schemaname IN ('public', 'stock', 'exploitation') ORDER BY 1`);
    expect(politiques.map((r) => r.p)).toEqual([]);
  });

  it("ne laissent AUCUN droit à anon/authenticated sur tables, séquences, fonctions et schémas stock/exploitation", async () => {
    const droits = await lignes<{ droit: string }>(SQL_DROITS_PUBLICS);
    expect(droits.map((d) => d.droit)).toEqual([]);
  });

  it("laissent USAGE sur public (défaut Supabase) et les droits de service_role intacts", async () => {
    const usage = await lignes<{ anon: boolean; service: boolean }>(`
      SELECT has_schema_privilege('anon', 'public', 'USAGE') AS anon,
             has_schema_privilege('service_role', 'public', 'USAGE') AS service`);
    expect(usage[0]).toEqual({ anon: true, service: true });
    const service = await lignes<{ privilege_type: string }>(
      SQL_DROITS_OBJET("service_role", `'public."Employee"'::regclass`, "relacl", "pg_class"),
    );
    expect(service.map((s) => s.privilege_type)).toContain("SELECT");
  });

  it("n'accordent rien à anon/authenticated sur une table, séquence ou fonction créée APRÈS", async () => {
    for (const schema of SCHEMAS_APP) {
      await sb.client.query(`CREATE TABLE ${schema}.apres_migrations (id serial PRIMARY KEY)`);
      await sb.client.query(`CREATE FUNCTION ${schema}.apres_migrations_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
      const objets: [string, string, string][] = [
        [`'${schema}.apres_migrations'::regclass`, "relacl", "pg_class"],
        [`'${schema}.apres_migrations_id_seq'::regclass`, "relacl", "pg_class"],
        [`'${schema}.apres_migrations_fn()'::regprocedure`, "proacl", "pg_proc"],
      ];
      try {
        for (const role of ROLES_PUBLICS) {
          for (const [oid, acl, cat] of objets) {
            const droits = await lignes<{ privilege_type: string }>(SQL_DROITS_OBJET(role, oid, acl, cat));
            expect(droits.map((d) => d.privilege_type), `${role} sur ${oid}`).toEqual([]);
          }
        }
      } finally {
        // Nettoyage même en cas d'échec : sinon le test d'idempotence rougirait en cascade.
        await sb.client.query(`DROP FUNCTION ${schema}.apres_migrations_fn(); DROP TABLE ${schema}.apres_migrations`);
      }
    }
    // Et service_role garde son privilège par défaut dans public (rien ne lui a été retiré).
    await sb.client.query(`CREATE TABLE public.apres_migrations_service (id int)`);
    const service = await lignes<{ privilege_type: string }>(
      SQL_DROITS_OBJET("service_role", "'public.apres_migrations_service'::regclass", "relacl", "pg_class"),
    );
    await sb.client.query(`DROP TABLE public.apres_migrations_service`);
    expect(service.map((s) => s.privilege_type)).toContain("SELECT");
  });

  it("la migration RLS partout est idempotente (un 2e passage ne change rien)", async () => {
    const avant = await lignes(SQL_INSTANTANE);
    const sql = fs.readFileSync(path.join(MIGRATIONS, "20260923150000_rls_partout", "migration.sql"), "utf8");
    await sb.client.query(sql);
    expect(await lignes(SQL_INSTANTANE)).toEqual(avant);
  });

  it("la migration RLS partout retire aussi un droit accordé à la main (fonction, séquence, schéma, colonne)", async () => {
    // Les migrations ne créent aujourd'hui ni fonction ni droit explicite : sans ce test, les
    // branches « fonctions », « schémas » et le chemin séquence de la migration ne seraient
    // jamais exécutées. On pose donc ces droits à la main, puis on rejoue la migration.
    const sql = fs.readFileSync(path.join(MIGRATIONS, "20260923150000_rls_partout", "migration.sql"), "utf8");
    const tableExploitation = await premiereTable("exploitation");
    await sb.client.query(`
      CREATE FUNCTION public.fn_ouverte() RETURNS int LANGUAGE sql AS 'SELECT 1';
      GRANT EXECUTE ON FUNCTION public.fn_ouverte() TO anon, authenticated;
      CREATE SEQUENCE stock.seq_ouverte;
      GRANT ALL ON SEQUENCE stock.seq_ouverte TO anon;
      GRANT USAGE, CREATE ON SCHEMA stock, exploitation TO anon, authenticated;
      GRANT SELECT ("id") ON exploitation."${tableExploitation}" TO authenticated;
    `);
    try {
      const poses = (await lignes<{ droit: string }>(SQL_DROITS_PUBLICS)).map((d) => d.droit).join("\n");
      for (const genre of ["sur fonction", "sur séquence", "sur schéma stock", "sur schéma exploitation", "sur colonne"]) {
        expect(poses, `la pose « ${genre} » n'a pas mordu`).toContain(genre);
      }
      await sb.client.query(sql);
      expect((await lignes<{ droit: string }>(SQL_DROITS_PUBLICS)).map((d) => d.droit)).toEqual([]);
    } finally {
      await sb.client.query(`DROP FUNCTION public.fn_ouverte(); DROP SEQUENCE stock.seq_ouverte;`);
    }
  });
});

describe("migrations rejouées sur un Postgres ORDINAIRE (sans les rôles Supabase)", () => {
  // Les bases de test, une base locale de démonstration : `anon`, `authenticated`, `service_role`
  // n'y existent pas. La migration ne doit pas casser, et la RLS doit quand même s'y appliquer.
  let ord: Base;
  beforeAll(async () => {
    ord = await demarrerBase();
    prismaSur(ord, ["migrate", "deploy"]);
  }, 600_000);
  afterAll(() => arreterBase(ord));

  it("s'appliquent toutes et activent la RLS partout", async () => {
    const roles = await lignesSur<{ n: number }>(ord, `SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')`);
    expect(roles[0].n).toBe(0);
    const tables = await lignesSur<{ nom: string; rls: boolean; force: boolean }>(ord, SQL_TABLES);
    expect(tables.length).toBeGreaterThan(80);
    expect(tables.filter((t) => !t.rls || t.force).map((t) => t.nom)).toEqual([]);
  });
});
