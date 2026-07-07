-- CreateEnum
CREATE TYPE "stock"."StatutFacture" AS ENUM ('A_REGLER', 'REGLEE', 'ECHUE_NON_REGLEE');

-- CreateTable
CREATE TABLE "stock"."FactureFournisseur" (
    "id" TEXT NOT NULL,
    "fournisseurId" TEXT,
    "fournisseurNom" TEXT NOT NULL,
    "numero" TEXT,
    "date" DATE,
    "dateEcheance" DATE,
    "datePaiement" DATE,
    "montantUSD" DECIMAL(14,2) NOT NULL,
    "montantRegleUSD" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "resteAPayerUSD" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "statut" "stock"."StatutFacture" NOT NULL DEFAULT 'A_REGLER',
    "modePaiement" TEXT,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureFournisseur_annee_mois_idx" ON "stock"."FactureFournisseur"("annee", "mois");

-- CreateIndex
CREATE INDEX "FactureFournisseur_fournisseurId_idx" ON "stock"."FactureFournisseur"("fournisseurId");

-- AddForeignKey
ALTER TABLE "stock"."FactureFournisseur" ADD CONSTRAINT "FactureFournisseur_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "stock"."Fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

