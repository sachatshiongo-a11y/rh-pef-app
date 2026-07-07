-- AlterTable
ALTER TABLE "stock"."FactureFournisseur" ADD COLUMN     "bonDeCommandeId" TEXT;

-- CreateIndex
CREATE INDEX "FactureFournisseur_bonDeCommandeId_idx" ON "stock"."FactureFournisseur"("bonDeCommandeId");

-- AddForeignKey
ALTER TABLE "stock"."FactureFournisseur" ADD CONSTRAINT "FactureFournisseur_bonDeCommandeId_fkey" FOREIGN KEY ("bonDeCommandeId") REFERENCES "stock"."BonDeCommande"("id") ON DELETE SET NULL ON UPDATE CASCADE;
