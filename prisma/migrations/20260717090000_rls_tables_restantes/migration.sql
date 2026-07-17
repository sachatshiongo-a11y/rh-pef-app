-- Défense en profondeur : RLS activée SANS policy = tout accès direct (API Data, clé anon/service
-- via PostgREST) est refusé. L'application n'est pas affectée : elle se connecte avec le rôle
-- `postgres` (rolbypassrls = true), comme pour les 62 tables déjà protégées.
-- Tables créées après la migration 20260712180000 et restées sans RLS.
ALTER TABLE "public"."SemainePubliee"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."DemandeChangementShift"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EchangeCreneau"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ParamEntreprise"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PretPersonnel"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."RetenuePret"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."ModeleTacheOnboarding"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."TacheOnboarding"         ENABLE ROW LEVEL SECURITY;
