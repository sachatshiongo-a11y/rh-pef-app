-- Pointage par QR : l'employé scanne l'affiche du restaurant. Ajoute la source « QR », l'historique
-- de chaque scan (ScanPointage, jamais réécrit) et le réglage (position, rayon, code de l'affiche)
-- sur la Config du restaurant.
-- Séparé de la création de table : PostgreSQL interdit d'utiliser une valeur d'enum
-- nouvellement ajoutée dans la même transaction que son ajout.
ALTER TYPE "public"."SourcePointage" ADD VALUE IF NOT EXISTS 'QR';

-- CreateEnum
CREATE TYPE "public"."MomentScan" AS ENUM ('ARRIVEE', 'DEPART');

-- CreateEnum
CREATE TYPE "public"."VerdictScan" AS ENUM ('AU_RESTAURANT', 'A_VERIFIER');

-- CreateEnum
CREATE TYPE "public"."MotifScan" AS ENUM ('LOIN', 'POSITION_REFUSEE', 'POSITION_INDISPONIBLE', 'PRECISION_INSUFFISANTE');

-- AlterTable
ALTER TABLE "public"."Config" ADD COLUMN     "pointageLatitude" DECIMAL(9,6),
ADD COLUMN     "pointageLongitude" DECIMAL(9,6),
ADD COLUMN     "pointageRayonM" INTEGER NOT NULL DEFAULT 150,
ADD COLUMN     "pointageCode" TEXT;

-- CreateTable
CREATE TABLE "public"."ScanPointage" (
    "id" TEXT NOT NULL,
    "pointageId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "moment" "public"."MomentScan" NOT NULL,
    "instant" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "precisionM" INTEGER,
    "distanceM" INTEGER,
    "verdict" "public"."VerdictScan" NOT NULL,
    "motif" "public"."MotifScan",
    "verifieParId" TEXT,
    "verifieLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanPointage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanPointage_pointageId_idx" ON "public"."ScanPointage"("pointageId");

-- CreateIndex
CREATE INDEX "ScanPointage_employeeId_instant_idx" ON "public"."ScanPointage"("employeeId", "instant");

-- CreateIndex
CREATE INDEX "ScanPointage_verdict_verifieLe_idx" ON "public"."ScanPointage"("verdict", "verifieLe");

-- AddForeignKey
ALTER TABLE "public"."ScanPointage" ADD CONSTRAINT "ScanPointage_pointageId_fkey" FOREIGN KEY ("pointageId") REFERENCES "public"."Pointage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScanPointage" ADD CONSTRAINT "ScanPointage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScanPointage" ADD CONSTRAINT "ScanPointage_verifieParId_fkey" FOREIGN KEY ("verifieParId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
