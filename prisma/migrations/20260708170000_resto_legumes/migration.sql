-- CreateEnum
CREATE TYPE "stock"."EspaceResto" AS ENUM ('CUISINE', 'BAR');

-- CreateTable
CREATE TABLE "stock"."AchatLegume" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "legume" TEXT NOT NULL,
    "unite" TEXT,
    "quantite" DECIMAL(14,3) NOT NULL,
    "montantCDF" DECIMAL(16,2),
    "montantUSD" DECIMAL(14,2),
    "tauxChangeUtilise" DECIMAL(10,2),
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchatLegume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."ArticleResto" (
    "id" TEXT NOT NULL,
    "espace" "stock"."EspaceResto" NOT NULL,
    "categorie" TEXT,
    "designation" TEXT NOT NULL,
    "unite" TEXT,
    "stockBaseJournalier" DECIMAL(14,3),
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ArticleResto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."ComptageResto" (
    "id" TEXT NOT NULL,
    "articleRestoId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantite" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ComptageResto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AchatLegume_date_idx" ON "stock"."AchatLegume"("date");

-- CreateIndex
CREATE INDEX "ArticleResto_espace_ordre_idx" ON "stock"."ArticleResto"("espace", "ordre");

-- CreateIndex
CREATE INDEX "ComptageResto_date_idx" ON "stock"."ComptageResto"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ComptageResto_articleRestoId_date_key" ON "stock"."ComptageResto"("articleRestoId", "date");

-- AddForeignKey
ALTER TABLE "stock"."ComptageResto" ADD CONSTRAINT "ComptageResto_articleRestoId_fkey" FOREIGN KEY ("articleRestoId") REFERENCES "stock"."ArticleResto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

