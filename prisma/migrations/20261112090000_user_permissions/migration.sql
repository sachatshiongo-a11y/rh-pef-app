-- PERMISSIONS PAR PERSONNE (comptes RH et Stock) : écarts décidés par la Direction (src/lib/permissions.ts).
-- Une colonne NULLABLE sur "User", PUREMENT ADDITIVE et idempotente : aucune ligne n'est réécrite.
-- NULL = comportement historique du rôle, exactement : rien ne change tant que la Direction ne coche rien.
-- Le code en production (qui ignore la colonne) continue de fonctionner.
--
-- Pas de nouvelle table : la RLS de "User" (migrations 20260712180000 et 20260717090000) et le retrait des
-- privilèges anon / authenticated s'appliquent déjà à la colonne ajoutée ; rien n'est modifié de ce côté.

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "permissions" JSONB;
