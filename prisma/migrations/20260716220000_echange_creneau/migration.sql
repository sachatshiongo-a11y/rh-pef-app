-- Échange de créneau entre deux salariés, à double validation (collègue + Direction).
CREATE TABLE IF NOT EXISTS "public"."EchangeCreneau" (
  "id" TEXT NOT NULL,
  "demandeurId" TEXT NOT NULL,
  "demandeurDate" DATE NOT NULL,
  "demandeurShiftId" TEXT NOT NULL,
  "collegueId" TEXT NOT NULL,
  "collegueDate" DATE NOT NULL,
  "collegueShiftId" TEXT NOT NULL,
  "motif" TEXT,
  "reponseCollegue" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
  "reponseDirection" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
  "statut" TEXT NOT NULL DEFAULT 'EN_ATTENTE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EchangeCreneau_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EchangeCreneau_demandeurId_idx" ON "public"."EchangeCreneau"("demandeurId");
CREATE INDEX IF NOT EXISTS "EchangeCreneau_collegueId_idx" ON "public"."EchangeCreneau"("collegueId");
CREATE INDEX IF NOT EXISTS "EchangeCreneau_statut_createdAt_idx" ON "public"."EchangeCreneau"("statut", "createdAt");
DO $$ BEGIN
  ALTER TABLE "public"."EchangeCreneau" ADD CONSTRAINT "EchangeCreneau_demandeurId_fkey"
    FOREIGN KEY ("demandeurId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "public"."EchangeCreneau" ADD CONSTRAINT "EchangeCreneau_collegueId_fkey"
    FOREIGN KEY ("collegueId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
