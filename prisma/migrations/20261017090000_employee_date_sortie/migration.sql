-- DATE DE SORTIE d'une fiche (décision de la Direction du 2026-10-12 : « il faut une date de sortie si le salarié
-- part ») : une colonne NULLABLE sur `Employee`. PUREMENT ADDITIVE et idempotente : aucune ligne n'est réécrite, le
-- code en production (qui ignore la colonne) continue de fonctionner.
--
-- La date d'une sortie passée par « Fin de contrat » reste dans `FinContrat.dateFin` (pas de doublon). Cette colonne
-- ne sert qu'aux fiches désactivées SANS fin de contrat : désactivation simple, ou anciens départs auxquels la
-- Direction donne leur date depuis la fiche. NULL = inconnue : la fiche inactive le signale, rien n'est deviné.
--
-- Pas de nouvelle table : la RLS de "Employee" (migrations 20260712180000 et 20260717090000) et le retrait des
-- privilèges anon / authenticated s'appliquent déjà à la colonne ajoutée ; rien n'est modifié de ce côté.

-- AlterTable
ALTER TABLE "public"."Employee" ADD COLUMN IF NOT EXISTS "dateSortie" DATE;
