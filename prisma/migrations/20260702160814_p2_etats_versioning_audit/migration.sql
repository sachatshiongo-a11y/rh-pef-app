-- CreateEnum
CREATE TYPE "ModePaiement" AS ENUM ('ESPECES', 'VIREMENT', 'MOBILE_MONEY', 'CHEQUE', 'AUTRE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'PREPARE';
ALTER TYPE "PaymentStatus" ADD VALUE 'VALIDE';
ALTER TYPE "PaymentStatus" ADD VALUE 'ANNULE';

-- AlterTable
ALTER TABLE "PayrollLine" ADD COLUMN     "modePaiement" "ModePaiement";

-- CreateTable
CREATE TABLE "TransitionPaie" (
    "id" TEXT NOT NULL,
    "payrollLineId" TEXT NOT NULL,
    "deStatut" "PaymentStatus" NOT NULL,
    "versStatut" "PaymentStatus" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "modePaiement" "ModePaiement",
    "preuveUrl" TEXT,
    "commentaire" TEXT,

    CONSTRAINT "TransitionPaie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionBulletin" (
    "id" TEXT NOT NULL,
    "payrollLineId" TEXT NOT NULL,
    "numeroVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "genereLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "genreParId" TEXT NOT NULL,

    CONSTRAINT "VersionBulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalAudit" (
    "id" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "champ" TEXT NOT NULL,
    "ancienneValeur" TEXT,
    "nouvelleValeur" TEXT,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransitionPaie_payrollLineId_idx" ON "TransitionPaie"("payrollLineId");

-- CreateIndex
CREATE INDEX "VersionBulletin_payrollLineId_idx" ON "VersionBulletin"("payrollLineId");

-- CreateIndex
CREATE UNIQUE INDEX "VersionBulletin_payrollLineId_numeroVersion_key" ON "VersionBulletin"("payrollLineId", "numeroVersion");

-- CreateIndex
CREATE INDEX "JournalAudit_entite_entiteId_idx" ON "JournalAudit"("entite", "entiteId");

-- CreateIndex
CREATE INDEX "JournalAudit_date_idx" ON "JournalAudit"("date");

-- AddForeignKey
ALTER TABLE "TransitionPaie" ADD CONSTRAINT "TransitionPaie_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "PayrollLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransitionPaie" ADD CONSTRAINT "TransitionPaie_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionBulletin" ADD CONSTRAINT "VersionBulletin_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "PayrollLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionBulletin" ADD CONSTRAINT "VersionBulletin_genreParId_fkey" FOREIGN KEY ("genreParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalAudit" ADD CONSTRAINT "JournalAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
