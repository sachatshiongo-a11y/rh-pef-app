-- Avantages en nature (informatifs) + majoration de prime en pourcentage.
--
-- L'avantage en nature est CONSIGNÉ et AFFICHÉ, jamais calculé : il n'entre ni dans l'assiette
-- CNSS/INPP/ONEM, ni dans la base IPR, ni dans le net à payer (décision 2026-08-16, traitement
-- fiscal À VALIDER par un comptable). Le snapshot sur PayrollLine sert uniquement à ce qu'un
-- bulletin archivé reste fidèle si la saisie change plus tard.

-- CreateTable
CREATE TABLE "public"."AvantageNature" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "nature" TEXT NOT NULL,
    "montantUSD" DECIMAL(12,2) NOT NULL,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "motif" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeParId" TEXT,

    CONSTRAINT "AvantageNature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AvantageNature_employeeId_annee_mois_idx" ON "public"."AvantageNature"("employeeId", "annee", "mois");

-- AddForeignKey
ALTER TABLE "public"."AvantageNature" ADD CONSTRAINT "AvantageNature_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable : snapshot informatif sur le bulletin. DEFAULT 0 → les bulletins déjà figés restent
-- rigoureusement identiques (aucun montant existant n'est touché).
ALTER TABLE "public"."PayrollLine" ADD COLUMN "avantagesNatureUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable : majoration en pourcentage du salaire de base + raison libre.
-- Le pourcentage est conservé pour la traçabilité ; c'est "montantUSD" qui fait foi.
ALTER TABLE "public"."Prime" ADD COLUMN "pourcentageBase" DECIMAL(5,2);
ALTER TABLE "public"."Prime" ADD COLUMN "motif" TEXT;
