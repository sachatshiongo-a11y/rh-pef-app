-- Disponibilité des plats (2026-09-24) : un article du restaurant peut être rattaché à un article
-- du catalogue, pour que son dernier comptage s'ajoute au stock du dépôt. Migration ADDITIVE :
-- colonne facultative, aucune ligne existante n'est rattachée (le rattachement est un geste de la
-- Direction, jamais une déduction).
ALTER TABLE "stock"."ArticleResto" ADD COLUMN "articleStockId" TEXT;

-- CreateIndex
CREATE INDEX "ArticleResto_articleStockId_idx" ON "stock"."ArticleResto"("articleStockId");

-- AddForeignKey
ALTER TABLE "stock"."ArticleResto" ADD CONSTRAINT "ArticleResto_articleStockId_fkey" FOREIGN KEY ("articleStockId") REFERENCES "stock"."ArticleStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
