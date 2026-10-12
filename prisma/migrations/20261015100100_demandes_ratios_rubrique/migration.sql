-- Demandes de modification des ratios cibles d'une rubrique, soumises à la Direction (2026-10-12,
-- décision de Sacha : « modification par la Compta = à valider par la Direction »). Migration
-- PUREMENT ADDITIVE et idempotente : une énumération et une table NEUVES dans `exploitation`. Aucune
-- table existante n'est modifiée, aucune donnée n'est réécrite.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "exploitation"."StatutDemandeRatios" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REFUSEE', 'ANNULEE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "exploitation"."DemandeRatiosRubrique" (
    "id" TEXT NOT NULL,
    "rubriqueId" INTEGER NOT NULL,
    "statut" "exploitation"."StatutDemandeRatios" NOT NULL DEFAULT 'EN_ATTENTE',
    "avant" JSONB NOT NULL,
    "apres" JSONB NOT NULL,
    "motif" TEXT,
    "cible" TEXT,
    "auteurId" TEXT NOT NULL,
    "auteurNom" TEXT NOT NULL,
    "decideurId" TEXT,
    "decideurNom" TEXT,
    "decideLe" TIMESTAMP(3),
    "motifRefus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandeRatiosRubrique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (verrou « une seule demande en attente par rubrique » : cible NULL une fois décidée)
CREATE UNIQUE INDEX IF NOT EXISTS "DemandeRatiosRubrique_cible_key" ON "exploitation"."DemandeRatiosRubrique"("cible");
CREATE INDEX IF NOT EXISTS "DemandeRatiosRubrique_statut_createdAt_idx" ON "exploitation"."DemandeRatiosRubrique"("statut", "createdAt");
CREATE INDEX IF NOT EXISTS "DemandeRatiosRubrique_rubriqueId_statut_idx" ON "exploitation"."DemandeRatiosRubrique"("rubriqueId", "statut");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "exploitation"."DemandeRatiosRubrique" ADD CONSTRAINT "DemandeRatiosRubrique_rubriqueId_fkey" FOREIGN KEY ("rubriqueId") REFERENCES "exploitation"."Rubrique"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout, et
-- privilèges anon/authenticated retirés (sans échec si ces rôles n'existent pas).
ALTER TABLE "exploitation"."DemandeRatiosRubrique" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "exploitation"."DemandeRatiosRubrique" FROM %I', r);
    END IF;
  END LOOP;
END $$;
