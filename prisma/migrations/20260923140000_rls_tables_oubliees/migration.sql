-- Défense en profondeur, comme 20260712180000 et 20260717090000 : RLS activée SANS règle = tout
-- accès direct (API Data, clé anon/service via PostgREST) est refusé. L'application n'est pas
-- affectée : elle se connecte avec le rôle `postgres` (rolbypassrls = true), comme pour les autres
-- tables déjà protégées.
--
-- Ces trois tables ont été créées sans la ligne `ENABLE ROW LEVEL SECURITY` (mesuré en production,
-- en lecture seule, le 2026-09-23 : `relrowsecurity = false`). Leurs migrations d'origine
-- (20260816090000, 20260816093000, 20260923090000) sont DÉJÀ appliquées en production et ne
-- doivent pas être modifiées (empreinte vérifiée par Prisma) : on corrige donc ici.
-- Instruction idempotente : sans effet sur une base où la RLS serait déjà active.
ALTER TABLE "public"."SignatureElectronique" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."MembreFamille"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AvantageNature"        ENABLE ROW LEVEL SECURITY;
