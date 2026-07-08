-- AlterTable
ALTER TABLE "stock"."Rapport" ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'pdf',
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'chiffre';

