-- Prêt au personnel : remboursement par retenues mensuelles sur la paie.
DO $$ BEGIN
  CREATE TYPE "public"."StatutPret" AS ENUM ('EN_COURS', 'SOLDE', 'ANNULE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "retenuePretUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "public"."PretPersonnel" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "montantUSD" DECIMAL(12,2) NOT NULL,
  "retenueMensuelleUSD" DECIMAL(12,2) NOT NULL,
  "motif" TEXT,
  "statut" "public"."StatutPret" NOT NULL DEFAULT 'EN_COURS',
  "dateAccord" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "creeParId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "PretPersonnel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PretPersonnel_employeeId_statut_idx" ON "public"."PretPersonnel"("employeeId", "statut");
DO $$ BEGIN
  ALTER TABLE "public"."PretPersonnel" ADD CONSTRAINT "PretPersonnel_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "public"."RetenuePret" (
  "id" TEXT NOT NULL,
  "pretId" TEXT NOT NULL,
  "mois" INTEGER NOT NULL,
  "annee" INTEGER NOT NULL,
  "montantUSD" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "RetenuePret_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RetenuePret_pretId_mois_annee_key" ON "public"."RetenuePret"("pretId", "mois", "annee");
CREATE INDEX IF NOT EXISTS "RetenuePret_pretId_idx" ON "public"."RetenuePret"("pretId");
DO $$ BEGIN
  ALTER TABLE "public"."RetenuePret" ADD CONSTRAINT "RetenuePret_pretId_fkey"
    FOREIGN KEY ("pretId") REFERENCES "public"."PretPersonnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
