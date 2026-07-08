-- AlterTable
ALTER TABLE "stock"."MouvementStock" ADD COLUMN     "categorieSortie" TEXT,
ADD COLUMN     "raisonSortie" TEXT;

-- CreateTable
CREATE TABLE "stock"."SessionComptage" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domaine" TEXT,
    "nbArticles" INTEGER NOT NULL DEFAULT 0,
    "nbEcarts" INTEGER NOT NULL DEFAULT 0,
    "nbHorsTol" INTEGER NOT NULL DEFAULT 0,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionComptage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."LigneComptage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "articleId" TEXT,
    "designation" TEXT NOT NULL,
    "theorique" DECIMAL(14,3) NOT NULL,
    "physique" DECIMAL(14,3) NOT NULL,
    "ecart" DECIMAL(14,3) NOT NULL,
    "ecartPct" DECIMAL(8,2),
    "explication" TEXT,

    CONSTRAINT "LigneComptage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."Rapport" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "periodeDebut" DATE,
    "periodeFin" DATE,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rapport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionComptage_date_idx" ON "stock"."SessionComptage"("date");

-- CreateIndex
CREATE INDEX "LigneComptage_sessionId_idx" ON "stock"."LigneComptage"("sessionId");

-- CreateIndex
CREATE INDEX "Rapport_type_createdAt_idx" ON "stock"."Rapport"("type", "createdAt");

-- CreateIndex
CREATE INDEX "MouvementStock_categorieSortie_date_idx" ON "stock"."MouvementStock"("categorieSortie", "date");

-- AddForeignKey
ALTER TABLE "stock"."LigneComptage" ADD CONSTRAINT "LigneComptage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "stock"."SessionComptage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

