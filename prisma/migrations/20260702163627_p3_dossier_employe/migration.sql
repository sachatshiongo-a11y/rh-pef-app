-- CreateEnum
CREATE TYPE "TypeContrat" AS ENUM ('CDD', 'CDI', 'STAGE', 'JOURNALIER');

-- CreateEnum
CREATE TYPE "StatutContrat" AS ENUM ('ACTIF', 'EXPIRE', 'RESILIE');

-- CreateEnum
CREATE TYPE "TypeDisciplinaire" AS ENUM ('AVERTISSEMENT', 'SANCTION', 'MISE_A_PIED', 'MESURE');

-- CreateEnum
CREATE TYPE "TypeDocument" AS ENUM ('CONTRAT', 'CARTE_IDENTITE', 'DIPLOME', 'PHOTO', 'CV', 'CERTIFICAT_MEDICAL', 'AVERTISSEMENT', 'LETTRE', 'AUTRE');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "adresse" TEXT,
ADD COLUMN     "dateNaissance" DATE,
ADD COLUMN     "telephone" TEXT;

-- CreateTable
CREATE TABLE "Contrat" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "TypeContrat" NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE,
    "finPeriodeEssai" DATE,
    "heuresHebdo" DECIMAL(5,2) NOT NULL DEFAULT 48,
    "salaireMensuel" DECIMAL(12,2) NOT NULL,
    "devise" TEXT NOT NULL DEFAULT 'USD',
    "poste" TEXT NOT NULL,
    "statut" "StatutContrat" NOT NULL DEFAULT 'ACTIF',
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contrat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoriqueSalaire" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ancienSalaire" DECIMAL(12,2),
    "nouveauSalaire" DECIMAL(12,2) NOT NULL,
    "ancienPoste" TEXT,
    "nouveauPoste" TEXT,
    "motif" TEXT NOT NULL,
    "decideParId" TEXT,

    CONSTRAINT "HistoriqueSalaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DossierDisciplinaire" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "TypeDisciplinaire" NOT NULL,
    "date" DATE NOT NULL,
    "motif" TEXT NOT NULL,
    "description" TEXT,
    "documentUrl" TEXT,
    "emisParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DossierDisciplinaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" INTEGER,
    "commentaire" TEXT,
    "evaluateur" TEXT,
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEmploye" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "TypeDocument" NOT NULL,
    "nom" TEXT NOT NULL,
    "fichierUrl" TEXT NOT NULL,
    "dateEmission" DATE,
    "dateExpiration" DATE,
    "importeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentEmploye_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contrat_employeeId_idx" ON "Contrat"("employeeId");

-- CreateIndex
CREATE INDEX "HistoriqueSalaire_employeeId_idx" ON "HistoriqueSalaire"("employeeId");

-- CreateIndex
CREATE INDEX "DossierDisciplinaire_employeeId_idx" ON "DossierDisciplinaire"("employeeId");

-- CreateIndex
CREATE INDEX "Evaluation_employeeId_idx" ON "Evaluation"("employeeId");

-- CreateIndex
CREATE INDEX "DocumentEmploye_employeeId_idx" ON "DocumentEmploye"("employeeId");

-- AddForeignKey
ALTER TABLE "Contrat" ADD CONSTRAINT "Contrat_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoriqueSalaire" ADD CONSTRAINT "HistoriqueSalaire_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossierDisciplinaire" ADD CONSTRAINT "DossierDisciplinaire_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEmploye" ADD CONSTRAINT "DocumentEmploye_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
