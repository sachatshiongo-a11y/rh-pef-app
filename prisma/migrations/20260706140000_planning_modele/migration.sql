-- Modèle hebdomadaire de planning par employé (rôle/shift habituel par jour de semaine).
CREATE TABLE "PlanningModele" (
  "id"         TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "jour"       INTEGER NOT NULL,
  "shiftId"    TEXT NOT NULL,
  CONSTRAINT "PlanningModele_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanningModele_employeeId_jour_key" ON "PlanningModele" ("employeeId", "jour");
CREATE INDEX "PlanningModele_employeeId_idx" ON "PlanningModele" ("employeeId");
