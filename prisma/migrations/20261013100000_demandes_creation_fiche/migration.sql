-- Créations de fiches salariés soumises à la validation de la Direction (2026-10-13, décision de
-- Sacha : « la création passe par la validation également »). Migration PUREMENT ADDITIVE et
-- idempotente : UNE table neuve dans `public` (l'énumération StatutDemandeFiche existe déjà, migration
-- 20261012120000). Aucune table existante n'est modifiée. Tant qu'aucune demande n'existe, rien ne change.
-- Pas de clé étrangère : la demande précède la fiche (employeeId n'est renseigné qu'à l'approbation).

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."DemandeCreationFiche" (
    "id" TEXT NOT NULL,
    "statut" "public"."StatutDemandeFiche" NOT NULL DEFAULT 'EN_ATTENTE',
    "nom" TEXT NOT NULL,
    "matricule" TEXT,
    "donnees" JSONB NOT NULL,
    "doublonsEcartes" TEXT NOT NULL DEFAULT '',
    "auteurId" TEXT NOT NULL,
    "auteurNom" TEXT NOT NULL,
    "decideurId" TEXT,
    "decideurNom" TEXT,
    "decideLe" TIMESTAMP(3),
    "motifRefus" TEXT,
    "noteDecision" TEXT,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandeCreationFiche_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandeCreationFiche_statut_createdAt_idx" ON "public"."DemandeCreationFiche"("statut", "createdAt");

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout. Aucun
-- droit à anon/authenticated, sans échec si ces rôles n'existent pas (base locale).
ALTER TABLE "public"."DemandeCreationFiche" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "public"."DemandeCreationFiche" FROM %I', r);
    END IF;
  END LOOP;
END $$;
