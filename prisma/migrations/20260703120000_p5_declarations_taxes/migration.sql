-- P5 : suivi des déclarations fiscales/sociales mensuelles (CNSS, IPR, INPP, ONEM).

-- CreateEnum
CREATE TYPE "TypeTaxe" AS ENUM ('CNSS', 'IPR', 'INPP', 'ONEM');

-- CreateEnum
CREATE TYPE "StatutDeclaration" AS ENUM ('A_DECLARER', 'DECLARE', 'PAYE');

-- CreateTable
CREATE TABLE "DeclarationTaxe" (
    "id" TEXT NOT NULL,
    "type" "TypeTaxe" NOT NULL,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "montantUSD" DECIMAL(14,2) NOT NULL,
    "montantCDF" DECIMAL(16,2) NOT NULL,
    "echeance" DATE NOT NULL,
    "statut" "StatutDeclaration" NOT NULL DEFAULT 'A_DECLARER',
    "marqueParId" TEXT,
    "dateMarquage" TIMESTAMP(3),

    CONSTRAINT "DeclarationTaxe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeclarationTaxe_type_mois_annee_key" ON "DeclarationTaxe"("type", "mois", "annee");
