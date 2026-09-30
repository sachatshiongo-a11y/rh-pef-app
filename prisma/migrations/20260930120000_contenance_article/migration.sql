-- Contenance d'un article du catalogue (import des fiches du bar, 2026-09-30). Migration PUREMENT
-- ADDITIVE : deux colonnes NOUVELLES, nullables, sur ArticleStock. Aucune colonne existante n'est
-- modifiée, aucune donnée n'est réécrite ; tant qu'elles sont nulles, aucun coût ne change.
-- « Absolut Vodka-75cl » en unité « Bouteille » : contenance 75, contenanceUnite « cl ».

-- AlterTable
ALTER TABLE "stock"."ArticleStock" ADD COLUMN "contenance" DECIMAL(12,3),
ADD COLUMN "contenanceUnite" TEXT;

-- Une contenance est strictement positive et va avec son unité (les deux, ou aucune).
ALTER TABLE "stock"."ArticleStock" ADD CONSTRAINT "ArticleStock_contenance_check"
  CHECK (("contenance" IS NULL AND "contenanceUnite" IS NULL) OR ("contenance" > 0 AND "contenanceUnite" IS NOT NULL));
