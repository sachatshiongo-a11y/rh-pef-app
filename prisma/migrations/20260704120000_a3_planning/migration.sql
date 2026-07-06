-- A3 : planning hebdomadaire prévisionnel (créneaux typés par employé et par jour).

-- CreateEnum
CREATE TYPE "CreneauPlanning" AS ENUM ('MATIN', 'APRES_MIDI', 'SOIR', 'NUIT', 'REPOS', 'CONGE', 'FERIE');

-- CreateTable
CREATE TABLE "PlanningCreneau" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "creneau" "CreneauPlanning" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningCreneau_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanningCreneau_employeeId_date_key" ON "PlanningCreneau"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "PlanningCreneau" ADD CONSTRAINT "PlanningCreneau_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
