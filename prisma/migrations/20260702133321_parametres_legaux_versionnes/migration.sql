-- CreateEnum
CREATE TYPE "StatutValidation" AS ENUM ('A_VALIDER', 'VALIDE');

-- AlterTable
ALTER TABLE "PayrollLine" ADD COLUMN     "inppUSD" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "onemUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ExerciceFiscal" (
    "id" SERIAL NOT NULL,
    "annee" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExerciceFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametreLegal" (
    "id" SERIAL NOT NULL,
    "exerciceId" INTEGER NOT NULL,
    "cle" TEXT NOT NULL,
    "valeur" DECIMAL(16,6),
    "unite" TEXT,
    "libelle" TEXT NOT NULL,
    "source" TEXT,
    "statutValidation" "StatutValidation" NOT NULL DEFAULT 'A_VALIDER',
    "commentaire" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParametreLegal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrancheIprCDF" (
    "id" SERIAL NOT NULL,
    "exerciceId" INTEGER NOT NULL,
    "ordre" INTEGER NOT NULL,
    "plafondAnnuelCDF" DECIMAL(18,2),
    "taux" DECIMAL(5,4) NOT NULL,
    "statutValidation" "StatutValidation" NOT NULL DEFAULT 'A_VALIDER',

    CONSTRAINT "TrancheIprCDF_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExerciceFiscal_annee_key" ON "ExerciceFiscal"("annee");

-- CreateIndex
CREATE UNIQUE INDEX "ParametreLegal_exerciceId_cle_key" ON "ParametreLegal"("exerciceId", "cle");

-- CreateIndex
CREATE UNIQUE INDEX "TrancheIprCDF_exerciceId_ordre_key" ON "TrancheIprCDF"("exerciceId", "ordre");

-- AddForeignKey
ALTER TABLE "ParametreLegal" ADD CONSTRAINT "ParametreLegal_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "ExerciceFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrancheIprCDF" ADD CONSTRAINT "TrancheIprCDF_exerciceId_fkey" FOREIGN KEY ("exerciceId") REFERENCES "ExerciceFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
