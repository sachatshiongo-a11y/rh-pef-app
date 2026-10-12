-- Audit restaurant du 10/10/2026 : auteur et horodatage de la DERNIÈRE saisie d'un comptage du
-- restaurant et d'une commande journalière. Migration PUREMENT ADDITIVE : des colonnes NOUVELLES,
-- facultatives, sur des tables existantes (les lignes déjà saisies gardent « inconnu » : le logiciel
-- n'invente ni auteur ni date). RLS et privilèges inchangés (aucune table nouvelle).

-- AlterTable
ALTER TABLE "stock"."ComptageResto" ADD COLUMN IF NOT EXISTS "saisiParId" TEXT;
ALTER TABLE "stock"."ComptageResto" ADD COLUMN IF NOT EXISTS "saisiLe" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "stock"."CommandeResto" ADD COLUMN IF NOT EXISTS "saisiParId" TEXT;
ALTER TABLE "stock"."CommandeLegumeResto" ADD COLUMN IF NOT EXISTS "saisiParId" TEXT;
