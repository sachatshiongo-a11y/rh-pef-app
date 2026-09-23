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
-- mais BYPASSRLS et propriétaire des tables). Rien n'est retiré à `postgres` ni à `service_role`,
-- sauf ce que `service_role` tenait de PUBLIC (EXECUTE sur une fonction nouvelle hors de `public`).
--
-- IDEMPOTENTE : chaque boucle ne vise que ce qui MANQUE (table sans RLS, droit effectivement
-- présent dans l'ACL). Sur la production, qui a déjà tout cela, aucun ALTER TABLE ni REVOKE n'est
-- exécuté ; seuls les ALTER DEFAULT PRIVILEGES s'exécutent (voir 4 : le seul effet NOUVEAU est que
-- les FUTURES fonctions de `postgres` ne sont plus exécutables par PUBLIC). Sur un Postgres
-- ORDINAIRE (bases de test : rôles Supabase absents), seule la RLS s'applique.
--
-- PÉRIMÈTRE STRICT : schémas `public`, `stock`, `exploitation` uniquement. Les schémas de Supabase
-- (auth, storage, realtime, cron, vault, net, extensions…) ne sont jamais touchés. L'USAGE sur le
-- schéma `public` est laissé tel quel (valeur Supabase par défaut, présente en production).
-- N'agit QUE sur les objets dont le rôle courant est membre du propriétaire, et JAMAIS sur un objet
-- d'extension : une table de `public` appartenant à un autre rôle (ex. PostGIS installé dans
-- `public` crée `spatial_ref_sys`, propriétaire `supabase_admin`) ferait sinon ÉCHOUER le
-- déploiement (« must be owner of table »), et un REVOKE sur un objet d'autrui n'émet qu'un
-- WARNING en laissant le droit.
--
-- Garde-fou : src/lib/migrations.integration.test.ts rejoue TOUTES les migrations sur une base
-- « Supabase neuve » simulée (migrations jouées par un `postgres` NON superutilisateur) et vérifie
-- les droits EFFECTIFS d'anon/authenticated (y compris ceux qui passent par PUBLIC).
DO $$
DECLARE
  r              record;
  role_nom       text;
  cibles         oid[];
  supabase       boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated'));
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
      AND pg_has_role(c.relowner, 'USAGE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.nspname, r.relname);
  END LOOP;

  IF NOT supabase THEN
    RETURN;
  END IF;

  -- Rôles dont on retire les droits : anon, authenticated et PUBLIC (oid 0 dans les ACL). Un droit
  -- accordé à PUBLIC est un droit d'anon : une fonction de `public` exécutable par PUBLIC est
  -- appelable par la clé anon via /rpc.
  cibles := ARRAY(SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) || 0::oid;

  -- 2a. Tables, vues, séquences : REVOKE ALL là où un rôle ciblé a un droit, sur l'objet OU sur
  --     l'une de ses colonnes (REVOKE ALL ON TABLE retire aussi les droits de colonne).
  FOR r IN
    SELECT n.nspname, c.relname, c.relkind, a.grantee
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL (
      SELECT x.grantee FROM aclexplode(c.relacl) x
      UNION
      SELECT x.grantee FROM pg_attribute att, aclexplode(att.attacl) x WHERE att.attrelid = c.oid
    ) a
    WHERE n.nspname IN ('public', 'stock', 'exploitation')
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND a.grantee = ANY (cibles)
      AND pg_has_role(c.relowner, 'USAGE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON %s %I.%I FROM %s',
      CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      r.nspname, r.relname,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END
    );
  END LOOP;

  -- 2b. Fonctions et procédures. Une ACL NULL vaut « valeur par défaut », qui accorde EXECUTE à
  --     PUBLIC : elle est donc visée aussi.
  FOR r IN
    SELECT DISTINCT p.oid::regprocedure AS signature, a.grantee
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL (
      SELECT x.grantee FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    ) a
    WHERE n.nspname IN ('public', 'stock', 'exploitation')
      AND a.grantee = ANY (cibles)
      AND pg_has_role(p.proowner, 'USAGE')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON ROUTINE %s FROM %s', r.signature,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END
    );
  END LOOP;

  -- 2c. Droits sur les schémas `stock` et `exploitation` (PAS sur `public`, volontairement).
  FOR r IN
    SELECT DISTINCT n.nspname, a.grantee
    FROM pg_namespace n, aclexplode(n.nspacl) a
    WHERE n.nspname IN ('stock', 'exploitation')
      AND a.grantee = ANY (cibles)
      AND pg_has_role(n.nspowner, 'USAGE')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON SCHEMA %I FROM %s', r.nspname,
      CASE WHEN r.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(r.grantee)) END
    );
  END LOOP;

  -- 3. Privilèges par défaut du propriétaire `postgres` dans ces schémas : les FUTURES
  --    tables/séquences/fonctions n'accorderont plus rien à anon ni à authenticated.
  FOREACH role_nom IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_nom);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, stock, exploitation REVOKE ALL ON TABLES FROM %I', role_nom);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, stock, exploitation REVOKE ALL ON SEQUENCES FROM %I', role_nom);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, stock, exploitation REVOKE ALL ON FUNCTIONS FROM %I', role_nom);
  END LOOP;

  -- 4. EXECUTE accordé à PUBLIC sur toute nouvelle fonction : c'est un défaut GLOBAL de Postgres,
  --    qu'une clause IN SCHEMA ne peut pas retirer. Sans schéma, donc. `postgres` (propriétaire)
  --    et `service_role` (privilèges par défaut de Supabase dans `public`) gardent les leurs.
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
END
$$;
