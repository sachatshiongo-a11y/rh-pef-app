-- Composition familiale nominative (conjoint + enfants avec dates de naissance).
-- Justificatif de la réduction IPR pour charges de famille : un contrôle demande des noms et des
-- dates, pas un compteur. Ne pilote AUCUN calcul : « Employee"."enfants" reste la source de la paie.

-- CreateEnum
CREATE TYPE "public"."LienFamilial" AS ENUM ('CONJOINT', 'ENFANT');

-- CreateTable
CREATE TABLE "public"."MembreFamille" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "lien" "public"."LienFamilial" NOT NULL,
    "nom" TEXT NOT NULL,
    "dateNaissance" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeParId" TEXT,

    CONSTRAINT "MembreFamille_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembreFamille_employeeId_idx" ON "public"."MembreFamille"("employeeId");

-- AddForeignKey
ALTER TABLE "public"."MembreFamille" ADD CONSTRAINT "MembreFamille_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable : âge limite d'un enfant à charge, paramétrable. 18 ans par défaut, À VALIDER.
ALTER TABLE "public"."Config" ADD COLUMN "ageLimiteEnfantACharge" INTEGER NOT NULL DEFAULT 18;
