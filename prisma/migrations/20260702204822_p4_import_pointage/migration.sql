-- CreateEnum
CREATE TYPE "SourcePointage" AS ENUM ('MANUEL', 'IVMS_RAPPORT', 'IVMS_API');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "idExterneIVMS" TEXT;

-- CreateTable
CREATE TABLE "ImportPointage" (
    "id" TEXT NOT NULL,
    "source" "SourcePointage" NOT NULL,
    "nomFichier" TEXT,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "nbLignes" INTEGER NOT NULL DEFAULT 0,
    "nbAppliques" INTEGER NOT NULL DEFAULT 0,
    "anomalies" JSONB,
    "importeParId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportPointage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportPointage_annee_mois_idx" ON "ImportPointage"("annee", "mois");
