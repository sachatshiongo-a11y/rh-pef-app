-- Commande de livraison au restaurant : quantité commandée par article et par jour.
CREATE TABLE "stock"."CommandeResto" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantite" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommandeResto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommandeResto_articleId_date_key" ON "stock"."CommandeResto"("articleId", "date");
CREATE INDEX "CommandeResto_date_idx" ON "stock"."CommandeResto"("date");
ALTER TABLE "stock"."CommandeResto" ADD CONSTRAINT "CommandeResto_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "stock"."ArticleStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
