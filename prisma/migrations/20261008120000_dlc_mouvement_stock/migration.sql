-- DLC facultative sur la Liste d'achat (demande de la Direction du 2026-10-08). Migration PUREMENT
-- ADDITIVE : une colonne NOUVELLE, nullable, sur MouvementStock. Aucune colonne existante n'est
-- modifiée, aucune donnée n'est réécrite ; une entrée sans DLC reste telle quelle (NULL).
-- Pas de nouvelle table : la protection RLS de "stock"."MouvementStock" (déjà activée) couvre la colonne.

-- AlterTable
ALTER TABLE "stock"."MouvementStock" ADD COLUMN "dlc" DATE;

-- Le bloc « DLC proches » du tableau de bord lit les entrées récentes qui ont une DLC.
CREATE INDEX "MouvementStock_dlc_idx" ON "stock"."MouvementStock"("dlc");
