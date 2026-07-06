-- Modèle hebdo bi-hebdomadaire : semaine 0 = chaque semaine, 1 = semaine A, 2 = semaine B.
ALTER TABLE "PlanningModele" ADD COLUMN "semaine" INTEGER NOT NULL DEFAULT 0;
DROP INDEX "PlanningModele_employeeId_jour_key";
CREATE UNIQUE INDEX "PlanningModele_employeeId_jour_semaine_key" ON "PlanningModele" ("employeeId", "jour", "semaine");
