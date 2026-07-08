-- CreateTable
CREATE TABLE "stock"."LigneFacture" (
    "id" TEXT NOT NULL,
    "factureId" TEXT NOT NULL,
    "articleId" TEXT,
    "designation" TEXT NOT NULL,
    "unite" TEXT,
    "quantite" DECIMAL(14,3) NOT NULL,
    "prixUnitaireUSD" DECIMAL(12,4) NOT NULL,
    "totalLigneUSD" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "LigneFacture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LigneFacture_factureId_idx" ON "stock"."LigneFacture"("factureId");

-- AddForeignKey
ALTER TABLE "stock"."LigneFacture" ADD CONSTRAINT "LigneFacture_factureId_fkey" FOREIGN KEY ("factureId") REFERENCES "stock"."FactureFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."LigneFacture" ADD CONSTRAINT "LigneFacture_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "stock"."ArticleStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

