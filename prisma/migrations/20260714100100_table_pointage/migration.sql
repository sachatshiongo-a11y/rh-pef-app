-- Table du pointage self-service : un enregistrement par employé et par jour.
CREATE TABLE "public"."Pointage" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "heureDebut" TIMESTAMP(3) NOT NULL,
    "heureFin" TIMESTAMP(3),
    "pauseMinutes" INTEGER NOT NULL DEFAULT 0,
    "source" "public"."SourcePointage" NOT NULL DEFAULT 'APP',
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Pointage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Pointage_employeeId_date_key" ON "public"."Pointage"("employeeId", "date");
CREATE INDEX "Pointage_date_idx" ON "public"."Pointage"("date");
ALTER TABLE "public"."Pointage" ADD CONSTRAINT "Pointage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Sécurité : RLS activée (le rôle applicatif bypass RLS ; bloque l'API Data comme les autres tables).
ALTER TABLE "public"."Pointage" ENABLE ROW LEVEL SECURITY;
