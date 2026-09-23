-- Paie brigade sur heures planifiées (spec 2026-09-23) — migration PUREMENT ADDITIVE.
-- Les lignes existantes prennent la source CONTRAT : elles ont été calculées sur le contrat.
-- Aucune table créée : la RLS de "PayrollLine" (migration 20260923150000_rls_partout) reste en place.

-- CreateEnum
CREATE TYPE "public"."SourceReferencePaie" AS ENUM ('PLANNING', 'CONTRAT', 'CONTRAT_REPLI');

-- AlterTable
ALTER TABLE "public"."PayrollLine" ADD COLUMN     "avertissementsPaie" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "heuresPayeesNonTravaillees" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "motifReference" TEXT,
ADD COLUMN     "sourceReference" "public"."SourceReferencePaie" NOT NULL DEFAULT 'CONTRAT';
