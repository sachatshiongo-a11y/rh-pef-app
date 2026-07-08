-- AlterTable
ALTER TABLE "stock"."MouvementStock" ADD COLUMN     "factureId" TEXT;

-- CreateIndex
CREATE INDEX "MouvementStock_factureId_idx" ON "stock"."MouvementStock"("factureId");

-- AddForeignKey
ALTER TABLE "stock"."MouvementStock" ADD CONSTRAINT "MouvementStock_factureId_fkey" FOREIGN KEY ("factureId") REFERENCES "stock"."FactureFournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

