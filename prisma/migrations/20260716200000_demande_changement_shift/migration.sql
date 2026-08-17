-- Demande de changement de shift par un salarié (self-service), validée par la Direction.
CREATE TABLE IF NOT EXISTS "public"."DemandeChangementShift" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "shiftActuelId" TEXT,
  "shiftDemandeId" TEXT NOT NULL,
  "motif" TEXT,
  "statut" "public"."LeaveStatus" NOT NULL DEFAULT 'EN_ATTENTE',
  "decideParId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DemandeChangementShift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DemandeChangementShift_employeeId_idx" ON "public"."DemandeChangementShift"("employeeId");
CREATE INDEX IF NOT EXISTS "DemandeChangementShift_statut_createdAt_idx" ON "public"."DemandeChangementShift"("statut", "createdAt");
DO $$ BEGIN
  ALTER TABLE "public"."DemandeChangementShift"
    ADD CONSTRAINT "DemandeChangementShift_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
