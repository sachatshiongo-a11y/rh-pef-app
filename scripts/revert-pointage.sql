-- ============================================================================
-- RETRAIT de la pointeuse self-service (fonctionnalité de TEST, réversible).
-- À exécuter UNIQUEMENT si la Direction décide de ne pas garder le pointage interne.
--
--   DATABASE_URL="postgresql://…" psql "$DATABASE_URL" -f scripts/revert-pointage.sql
--   (ou coller dans Supabase → SQL Editor)
--
-- Effet : supprime la table de pointage. Les Présences (codes) et Heures déjà
-- reportées ne sont PAS touchées (ce sont des données de paie) ; si des pointages
-- de test ont été saisis, nettoie-les d'abord dans Présences / Heures si besoin.
-- ============================================================================

DROP TABLE IF EXISTS "public"."Pointage";

-- Remarque : la valeur d'enum 'APP' (SourcePointage) reste en place — PostgreSQL ne
-- permet pas de retirer simplement une valeur d'enum, et elle est inoffensive une fois
-- la table supprimée (plus aucune ligne ne l'utilise).

-- Côté code, pour retirer complètement l'onglet : supprimer le dossier
-- src/app/(app)/pointer/ et la ligne { href: "/pointer", … } dans app-shell.tsx.
