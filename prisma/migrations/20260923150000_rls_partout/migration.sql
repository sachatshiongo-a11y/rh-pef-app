-- RLS PARTOUT + aucun droit pour `anon`/`authenticated` — mettre le CODE au niveau de la PRODUCTION.
--
-- Pourquoi. La base de production est protégée par trois mécanismes qui n'étaient écrits NULLE
-- PART dans les migrations (mesuré en production, en lecture seule, le 2026-09-23) :
--   1. RLS activée (ENABLE, sans FORCE) sur les 83 tables des schémas `public` (52), `stock` (25)
--      et `exploitation` (6), avec ZÉRO politique : tout est fermé aux rôles qui ne contournent
--      pas la RLS (l'API Data de Supabase, via PostgREST, avec les clés anon/authenticated).
--   2. AUCUN droit pour `anon` ni `authenticated` sur les tables, séquences et fonctions de ces
--      trois schémas (0 ligne dans role_table_grants, role_usage_grants, role_routine_grants).
--      Ils gardent USAGE sur le schéma `public` (valeur par défaut de Supabase), pas sur `stock`
--      ni sur `exploitation`.
--   3. Privilèges par défaut modifiés : pour le propriétaire `postgres` dans `public`, les futures
--      tables/séquences/fonctions ne sont accordées qu'à `postgres` et `service_role`.
-- Une base reconstruite par les SEULES migrations (restauration, nouveau client, démonstration)
-- laissait 53 tables SANS RLS (dont Employee, User, PayrollLine et tout le schéma `stock`) et, sur
-- Supabase, ces tables recevaient les droits par défaut d'`anon`/`authenticated` : lisibles et
-- modifiables par quiconque détient la clé publique du projet. Cette migration ferme ce trou.
--
-- L'application n'est PAS affectée : elle se connecte avec le rôle `postgres` (non superutilisateur,
-- mais BYPASSRLS et propriétaire des tables). Rien n'est retiré à `postgres` ni à `service_role`.
--
-- IDEMPOTENTE et SANS EFFET sur la production (qui a déjà tout cela) : chaque boucle ne vise que ce
-- qui MANQUE (table sans RLS, droit effectivement présent dans l'ACL), donc aucune instruction n'y
-- est exécutée ; seuls les ALTER DEFAULT PRIVILEGES s'exécutent, et retirent ce qui n'y est déjà
-- plus. Sur un Postgres ORDINAIRE (bases de test : les rôles Supabase n'existent pas), seule la RLS
-- s'applique ; le reste est sauté rôle par rôle.
--
-- PÉRIMÈTRE STRICT : schémas `public`, `stock`, `exploitation` uniquement. Les schémas de Supabase
-- (auth, storage, realtime, cron, vault, net, extensions…) ne sont jamais touchés. L'USAGE sur le
-- schéma `public` est laissé tel quel (valeur Supabase par défaut, présente en production).
--
-- Garde-fou : src/lib/migrations.integration.test.ts rejoue TOUTES les migrations sur une base
-- « Supabase neuve » simulée et vérifie chacun de ces points.
DO $$
DECLARE
  r        record;
  role_nom text;
BEGIN
  -- 1. RLS (ENABLE, jamais FORCE, aucune politique) sur toute table qui ne l'a pas encore.
  --    Inclut `_prisma_migrations` (elle l'a en production).
  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'stock', 'exploitation')
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.nspname, r.relname);
  END LOOP;

  FOREACH role_nom IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_nom);

    -- 2a. Tables, vues, séquences : REVOKE ALL là où le rôle a un droit direct, sur l'objet OU sur
    --     l'une de ses colonnes (REVOKE ALL ON TABLE retire aussi les droits de colonne).
    FOR r IN
      SELECT n.nspname, c.relname, c.relkind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'stock', 'exploitation')
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND (
          EXISTS (
            SELECT 1 FROM aclexplode(c.relacl) a
            WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = role_nom)
          )
          OR EXISTS (
            SELECT 1 FROM pg_attribute att, aclexplode(att.attacl) a
            WHERE att.attrelid = c.oid
              AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = role_nom)
          )
        )
    LOOP
      EXECUTE format(
        'REVOKE ALL ON %s %I.%I FROM %I',
        CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
        r.nspname, r.relname, role_nom
      );
    END LOOP;

    -- 2b. Fonctions et procédures.
    FOR r IN
      SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'stock', 'exploitation')
        AND EXISTS (
          SELECT 1 FROM aclexplode(p.proacl) a
          WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = role_nom)
        )
    LOOP
      EXECUTE format('REVOKE ALL ON ROUTINE %s FROM %I', r.signature, role_nom);
    END LOOP;

    -- 2c. USAGE sur `stock` et `exploitation` (PAS sur `public`, volontairement).
    FOR r IN
      SELECT n.nspname
      FROM pg_namespace n
      WHERE n.nspname IN ('stock', 'exploitation')
        AND EXISTS (
          SELECT 1 FROM aclexplode(n.nspacl) a
          WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = role_nom)
        )
    LOOP
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', r.nspname, role_nom);
    END LOOP;

    -- 3. Privilèges par défaut du propriétaire `postgres` : les FUTURES tables/séquences/fonctions
    --    de ces schémas n'accorderont plus rien à ce rôle.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, stock, exploitation REVOKE ALL ON TABLES FROM %I', role_nom);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, stock, exploitation REVOKE ALL ON SEQUENCES FROM %I', role_nom);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, stock, exploitation REVOKE ALL ON FUNCTIONS FROM %I', role_nom);
    END IF;
  END LOOP;
END
$$;
