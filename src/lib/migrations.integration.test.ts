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
// dossier de migration n'en exécutent qu'un fragment, sur une base « db push »). Or c'est ce SQL,
// et lui seul, qui reconstruit une base réelle (restauration, nouveau client, démonstration). Le
// 2026-09-23, on a mesuré qu'une base reconstruite ainsi laissait 53 tables SANS RLS (Employee,
// User, PayrollLine, 19 tables de `stock`…) et, sur Supabase, les ouvrait aux rôles publics
// `anon`/`authenticated` — alors que la production, corrigée à la main, était fermée. Ce test
// rejoue les migrations sur une base « Supabase neuve » simulée et exige qu'on retombe sur l'état
// de la production.
//
// La simulation est FIDÈLE sur le point qui compte : comme sur Supabase, le superutilisateur est
// `supabase_admin`, et les migrations sont jouées par `postgres`, NON superutilisateur (BYPASSRLS,
// CREATEROLE). Un `postgres` superutilisateur masquerait les refus (« must be owner of table »),
// les REVOKE qui n'émettent qu'un WARNING, et les ALTER DEFAULT PRIVILEGES interdits.
//
// On mesure des droits EFFECTIFS (has_table_privilege, has_function_privilege…), pas seulement les
// lignes accordées nommément : un droit donné à PUBLIC est un droit d'anon (une fonction de
// `public` exécutable par PUBLIC est appelable par la clé anon via /rpc).
//
// POUR L'AVENIR : toute NOUVELLE migration qui crée une table dans `public`, `stock` ou
// `exploitation` sans `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, ou qui accorde un droit à
// anon/authenticated/PUBLIC sur une table, une séquence, une fonction ou ces schémas, fait rougir
// ce test, par construction : il rejoue TOUTES les migrations présentes dans le dossier, y compris
// celles écrites après lui, et vérifie TOUS les objets.
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
const MIGRATION_RLS = path.join(MIGRATIONS, "20260923150000_rls_partout", "migration.sql");
const SCHEMAS_APP = ["public", "stock", "exploitation"];

/** Garde bloquante : lève si l'URL ne vise pas une base locale. Appelée avant CHAQUE commande. */
function exigerUrlLocale(url: string): void {
  if (!/^postgresql:\/\/[^@/]+@(localhost|127\.0\.0\.1):\d+\/[^/?#]+$/.test(url)) {
    throw new Error(`REFUS : URL non locale, le test des migrations ne s'y connectera pas (${url.replace(/:[^:@/]*@/, ":***@")})`);
  }
}

/**
 * Une base jetable. `client` est connecté en `postgres` (le rôle qui joue les migrations, comme en
 * production) ; `admin` en superutilisateur, pour préparer la simulation.
 */
type Base = { pg: EmbeddedPostgres; dir: string; url: string; config: string; client: Client; admin: Client };

/**
 * `supabase: true` : superutilisateur `supabase_admin`, `postgres` NON superutilisateur, rôles
 * publics et privilèges par défaut de Supabase. `supabase: false` : Postgres ordinaire, où
 * `postgres` est le superutilisateur et où les rôles Supabase n'existent pas.
 */
async function demarrerBase(supabase: boolean): Promise<Base> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pef-migrations-"));
  const port = 55000 + Math.floor(Math.random() * 4000);
  const superU = supabase ? "supabase_admin" : "postgres";
  const urlAdmin = `postgresql://${superU}:admin@localhost:${port}/migdb`;
  const url = `postgresql://postgres:${supabase ? "postgres" : "admin"}@localhost:${port}/migdb`;
  exigerUrlLocale(urlAdmin);
  exigerUrlLocale(url);

  // Configuration Prisma À PART : aucun import (donc aucun dotenv), URL jetable écrite en dur.
  const config = path.join(dir, "prisma.config.ts");
  fs.writeFileSync(config, `export default ${JSON.stringify({
    schema: SCHEMA,
    migrations: { path: MIGRATIONS },
    datasource: { url },
  }, null, 2)};\n`);

  const pg = new EmbeddedPostgres({ databaseDir: path.join(dir, "data"), user: superU, password: "admin", port, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("migdb");
  const admin = new Client({ connectionString: urlAdmin });
  await admin.connect();

  if (supabase) {
    // Simule une base Supabase NEUVE — le scénario dangereux : les rôles publics existent, ont
    // USAGE sur `public` et reçoivent par défaut TOUS les droits sur ce que `postgres` y crée.
    await admin.query(`
      CREATE ROLE postgres LOGIN PASSWORD 'postgres' NOSUPERUSER BYPASSRLS CREATEROLE CREATEDB;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT ALL ON DATABASE migdb TO postgres;
      GRANT USAGE, CREATE ON SCHEMA public TO postgres;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
    `);
  }
  const client = supabase ? new Client({ connectionString: url }) : admin;
  if (supabase) await client.connect();
  return { pg, dir, url, config, client, admin };
}

async function arreterBase(b: Base | undefined): Promise<void> {
  if (!b) return;
  if (b.client !== b.admin) await b.client.end().catch(() => {});
  await b.admin.end().catch(() => {});
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

/** Joue le SQL de la migration RLS en `postgres` et renvoie les WARNING émis (il n'en faut aucun). */
async function rejouerMigrationRls(b: Base): Promise<string[]> {
  exigerUrlLocale(b.url);
  const avertissements: string[] = [];
  const surNotice = (n: { severity?: string; message?: string }) => {
    if (n.severity === "WARNING") avertissements.push(n.message ?? "");
  };
  b.client.on("notice", surNotice);
  try {
    await b.client.query(fs.readFileSync(MIGRATION_RLS, "utf8"));
  } finally {
    b.client.off("notice", surNotice);
  }
  return avertissements;
}

/** Tables de public/stock/exploitation avec leur état RLS. */
const SQL_TABLES = `
  SELECT format('%I.%I', n.nspname, c.relname) AS nom, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'stock', 'exploitation') AND c.relkind IN ('r', 'p')
  ORDER BY 1`;

/**
 * Droits EFFECTIFS d'anon/authenticated — accordés nommément, via PUBLIC, sur l'objet ou sur une
 * colonne — dans les schémas de l'application. USAGE sur `public` est toléré (défaut Supabase).
 */
const SQL_DROITS_EFFECTIFS = `
  WITH roles(r) AS (SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
  SELECT format('%s sur table %I.%I', r, n.nspname, c.relname) AS droit
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, roles
  WHERE n.nspname IN ('public', 'stock', 'exploitation') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR has_any_column_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  UNION ALL
  SELECT format('%s sur séquence %I.%I', r, n.nspname, c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, roles
  WHERE n.nspname IN ('public', 'stock', 'exploitation') AND c.relkind = 'S'
    AND has_sequence_privilege(r, c.oid, 'USAGE,SELECT,UPDATE')
  UNION ALL
  SELECT format('%s sur fonction %s', r, p.oid::regprocedure)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, roles
  WHERE n.nspname IN ('public', 'stock', 'exploitation') AND has_function_privilege(r, p.oid, 'EXECUTE')
  UNION ALL
  SELECT format('%s sur schéma %I', r, n.nspname)
  FROM pg_namespace n, roles
  WHERE (n.nspname IN ('stock', 'exploitation') AND has_schema_privilege(r, n.oid, 'USAGE,CREATE'))
     OR (n.nspname = 'public' AND has_schema_privilege(r, n.oid, 'CREATE'))
  ORDER BY 1`;

/** État observable après migration — sert à prouver qu'un 2e passage ne change rien. */
const SQL_INSTANTANE = `
  SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text AS acl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'stock', 'exploitation') AND c.relkind IN ('r', 'p', 'S')
  UNION ALL
  SELECT n.nspname, p.oid::regprocedure::text, NULL, NULL, p.proacl::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'stock', 'exploitation')
  UNION ALL
  SELECT coalesce(n.nspname, '(global)'), '(défauts ' || d.defaclobjtype::text || ')', NULL, NULL, d.defaclacl::text
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  UNION ALL
  SELECT nspname, '(schéma)', NULL, NULL, nspacl::text FROM pg_namespace WHERE nspname IN ('public', 'stock', 'exploitation')
  ORDER BY 1, 2`;

let sb: Base; // la base « Supabase neuve » simulée
const prisma = (args: string[]) => prismaSur(sb, args);
const lignes = <T>(sql: string) => lignesSur<T>(sb, sql);

/** Nom de la première table (ordre alphabétique) d'un schéma ayant une colonne `id`. */
async function premiereTable(schema: string): Promise<string> {
  const r = await lignes<{ t: string }>(`
    SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${schema}' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id')
    ORDER BY 1 LIMIT 1`);
  return r[0].t;
}

beforeAll(async () => {
  sb = await demarrerBase(true);
  // Témoin : la simulation mord-elle ? Une table et une fonction créées maintenant par `postgres`
  // DOIVENT être ouvertes à anon. Sinon, tous les « aucun droit » ci-dessous seraient vrais pour
  // une mauvaise raison.
  await sb.client.query(`
    CREATE TABLE public.temoin_simulation (id int);
    CREATE FUNCTION public.temoin_simulation_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';`);
  const temoin = await lignes<{ droit: string }>(SQL_DROITS_EFFECTIFS);
  const vu = temoin.map((t) => t.droit).join("\n");
  if (!vu.includes("anon sur table public.temoin_simulation") || !vu.includes("anon sur fonction temoin_simulation_fn()")) {
    throw new Error(`Simulation Supabase inopérante : le témoin n'est pas ouvert à anon (${vu})`);
  }
  await sb.client.query(`DROP TABLE public.temoin_simulation; DROP FUNCTION public.temoin_simulation_fn();`);

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

  it("sont jouées par un `postgres` NON superutilisateur, BYPASSRLS, propriétaire de tout", async () => {
    const moi = await lignes<{ u: string; su: boolean; bypass: boolean }>(
      `SELECT rolname AS u, rolsuper AS su, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
    );
    expect(moi[0]).toEqual({ u: "postgres", su: false, bypass: true });
    const autres = await lignes<{ o: string }>(`
      SELECT format('%I.%I (%s)', n.nspname, c.relname, pg_get_userbyid(c.relowner)) AS o
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'stock', 'exploitation') AND c.relowner <> 'postgres'::regrole
      ORDER BY 1`);
    expect(autres.map((a) => a.o)).toEqual([]);
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

  it("ne laissent AUCUN droit effectif à anon/authenticated (nommément ou via PUBLIC)", async () => {
    const droits = await lignes<{ droit: string }>(SQL_DROITS_EFFECTIFS);
    expect(droits.map((d) => d.droit)).toEqual([]);
  });

  it("laissent USAGE sur public (défaut Supabase) et les droits de postgres/service_role intacts", async () => {
    const r = await lignes<{ anon: boolean; service: boolean; pgTable: boolean; serviceTable: boolean }>(`
      SELECT has_schema_privilege('anon', 'public', 'USAGE') AS anon,
             has_schema_privilege('service_role', 'public', 'USAGE') AS service,
             has_table_privilege('postgres', 'public."Employee"', 'SELECT,INSERT,UPDATE,DELETE') AS "pgTable",
             has_table_privilege('service_role', 'public."Employee"', 'SELECT') AS "serviceTable"`);
    expect(r[0]).toEqual({ anon: true, service: true, pgTable: true, serviceTable: true });
  });

  it("n'accordent rien à anon/authenticated sur une table, séquence ou fonction créée APRÈS", async () => {
    for (const schema of SCHEMAS_APP) {
      await sb.client.query(`
        CREATE TABLE ${schema}.apres_migrations (id serial PRIMARY KEY);
        CREATE FUNCTION ${schema}.apres_migrations_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';`);
      try {
        const droits = await lignes<{ droit: string }>(SQL_DROITS_EFFECTIFS);
        expect(droits.map((d) => d.droit), `objets créés après, schéma ${schema}`).toEqual([]);
        // postgres (propriétaire) garde tout ; service_role garde ses défauts Supabase dans public.
        const garde = await lignes<{ pg: boolean; sr: boolean }>(`
          SELECT has_function_privilege('postgres', '${schema}.apres_migrations_fn()', 'EXECUTE')
             AND has_table_privilege('postgres', '${schema}.apres_migrations', 'SELECT,INSERT') AS pg,
                 has_function_privilege('service_role', '${schema}.apres_migrations_fn()', 'EXECUTE')
             AND has_table_privilege('service_role', '${schema}.apres_migrations', 'SELECT') AS sr`);
        expect(garde[0].pg).toBe(true);
        if (schema === "public") expect(garde[0].sr).toBe(true);
      } finally {
        // Nettoyage même en cas d'échec : sinon les tests suivants rougiraient en cascade.
        await sb.client.query(`DROP FUNCTION ${schema}.apres_migrations_fn(); DROP TABLE ${schema}.apres_migrations`);
      }
    }
  });

  it("la migration RLS partout est idempotente (un 2e passage ne change rien, sans WARNING)", async () => {
    const avant = await lignes(SQL_INSTANTANE);
    expect(await rejouerMigrationRls(sb)).toEqual([]);
    expect(await lignes(SQL_INSTANTANE)).toEqual(avant);
  });

  it("la migration RLS partout retire un droit posé à la main (nommé ou via PUBLIC, sur fonction, séquence, schéma, colonne)", async () => {
    // Les migrations ne créent aujourd'hui ni fonction ni droit explicite : sans ce test, ces
    // branches de la migration ne seraient jamais exécutées. On pose donc ces droits à la main.
    const tableExploitation = await premiereTable("exploitation");
    const tableStock = await premiereTable("stock");
    await sb.client.query(`
      CREATE FUNCTION public.fn_ouverte() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      GRANT EXECUTE ON FUNCTION public.fn_ouverte() TO anon, authenticated, PUBLIC;
      CREATE FUNCTION stock.fn_ouverte() RETURNS int LANGUAGE sql AS 'SELECT 1';
      GRANT EXECUTE ON FUNCTION stock.fn_ouverte() TO PUBLIC;
      CREATE SEQUENCE stock.seq_ouverte;
      GRANT ALL ON SEQUENCE stock.seq_ouverte TO anon;
      GRANT USAGE, CREATE ON SCHEMA stock, exploitation TO anon, authenticated;
      GRANT SELECT ("id") ON exploitation."${tableExploitation}" TO authenticated;
      GRANT SELECT, UPDATE ON stock."${tableStock}" TO PUBLIC;
    `);
    try {
      const poses = (await lignes<{ droit: string }>(SQL_DROITS_EFFECTIFS)).map((d) => d.droit).join("\n");
      for (const attendu of [
        "anon sur fonction fn_ouverte()", "anon sur fonction stock.fn_ouverte()", "anon sur séquence stock.seq_ouverte",
        "anon sur schéma stock", "authenticated sur schéma exploitation",
        `authenticated sur table exploitation."${tableExploitation}"`, `anon sur table stock."${tableStock}"`,
      ]) {
        expect(poses, `la pose « ${attendu} » n'a pas mordu`).toContain(attendu);
      }
      expect(await rejouerMigrationRls(sb)).toEqual([]);
      expect((await lignes<{ droit: string }>(SQL_DROITS_EFFECTIFS)).map((d) => d.droit)).toEqual([]);
      const garde = await lignes<{ ok: boolean }>(
        `SELECT has_function_privilege('postgres', 'public.fn_ouverte()', 'EXECUTE') AS ok`,
      );
      expect(garde[0].ok).toBe(true);
    } finally {
      await sb.client.query(`
        DROP FUNCTION public.fn_ouverte(); DROP FUNCTION stock.fn_ouverte(); DROP SEQUENCE stock.seq_ouverte;
        REVOKE ALL ON stock."${tableStock}" FROM PUBLIC;`);
    }
  });

  it("la migration RLS partout ne casse pas sur une table de `public` appartenant à un autre rôle (ex. PostGIS)", async () => {
    // PostGIS installé dans `public` y crée `spatial_ref_sys`, propriétaire `supabase_admin` :
    // `postgres` ne peut ni y activer la RLS ni en retirer les droits. La migration doit l'ignorer
    // sans échouer (et sans WARNING), au lieu de bloquer le déploiement d'un nouveau client.
    await sb.admin.query(`
      CREATE TABLE public.spatial_ref_sys (srid int PRIMARY KEY);
      GRANT SELECT ON public.spatial_ref_sys TO anon, PUBLIC;`);
    try {
      expect(await rejouerMigrationRls(sb)).toEqual([]);
      const t = await lignes<{ rls: boolean }>(
        `SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.spatial_ref_sys'::regclass`,
      );
      expect(t[0].rls).toBe(false); // pas à nous : laissée telle quelle
    } finally {
      await sb.admin.query(`DROP TABLE public.spatial_ref_sys`);
    }
  });
});

describe("migrations rejouées sur un Postgres ORDINAIRE (sans les rôles Supabase)", () => {
  // Les bases de test, une base locale de démonstration : `anon`, `authenticated`, `service_role`
  // n'y existent pas. La migration ne doit pas casser, et la RLS doit quand même s'y appliquer.
  let ord: Base;
  beforeAll(async () => {
    ord = await demarrerBase(false);
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
