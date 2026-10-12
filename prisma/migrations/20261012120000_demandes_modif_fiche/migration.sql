-- Modifications de fiches salariés soumises à la validation de la Direction (2026-10-12, décision
-- de Sacha : « la direction valide les changements effectués par les autres rôles »). Migration
-- PUREMENT ADDITIVE et idempotente : une énumération et une table NEUVES dans `public`. Aucune table
-- existante n'est modifiée, aucune donnée n'est réécrite. Tant qu'aucune demande n'existe, rien ne change.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "public"."StatutDemandeFiche" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REFUSEE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."DemandeModifFiche" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "statut" "public"."StatutDemandeFiche" NOT NULL DEFAULT 'EN_ATTENTE',
    "origine" TEXT NOT NULL,
    "changements" JSONB NOT NULL,
    "motif" TEXT,
    "auteurId" TEXT NOT NULL,
    "auteurNom" TEXT NOT NULL,
    "decideurId" TEXT,
    "decideurNom" TEXT,
    "decideLe" TIMESTAMP(3),
    "motifRefus" TEXT,
    "noteDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandeModifFiche_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandeModifFiche_statut_createdAt_idx" ON "public"."DemandeModifFiche"("statut", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandeModifFiche_employeeId_statut_idx" ON "public"."DemandeModifFiche"("employeeId", "statut");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."DemandeModifFiche" ADD CONSTRAINT "DemandeModifFiche_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout. Aucun
-- droit à anon/authenticated : les privilèges par défaut de `postgres` les leur retirent déjà pour
-- toute table créée après la migration RLS partout ; on le redit ici, sans échec si ces rôles
-- n'existent pas (base locale).
ALTER TABLE "public"."DemandeModifFiche" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "public"."DemandeModifFiche" FROM %I', r);
    END IF;
  END LOOP;
END $$;
