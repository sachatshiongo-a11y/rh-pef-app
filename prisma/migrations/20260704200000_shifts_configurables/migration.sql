-- Shifts configurables : remplace l'enum CreneauPlanning par une table Shift.
-- Migration SANS perte : les créneaux existants sont rattachés aux shifts par défaut.

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "heureDebut" TEXT,
    "heureFin" TEXT,
    "couleur" TEXT NOT NULL DEFAULT 'indigo',
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "systeme" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- Shifts par défaut (ids fixes pour rattacher les créneaux existants).
INSERT INTO "Shift" ("id","nom","heureDebut","heureFin","couleur","ordre","systeme","actif","updatedAt") VALUES
 ('shift_matin','Matin','08:00','14:00','yellow',1,false,true,now()),
 ('shift_apresmidi','Après-midi','14:00','18:00','orange',2,false,true,now()),
 ('shift_soir','Soir','18:00','23:00','purple',3,false,true,now()),
 ('shift_nuit','Nuit','23:00','06:00','indigo',4,false,true,now()),
 ('shift_repos','Repos',NULL,NULL,'slate',5,true,true,now()),
 ('shift_conge','Congé',NULL,NULL,'blue',6,true,true,now()),
 ('shift_ferie','Férié',NULL,NULL,'pink',7,true,true,now());

-- Colonne shiftId (nullable le temps de la migration des données)
ALTER TABLE "PlanningCreneau" ADD COLUMN "shiftId" TEXT;

-- Rattachement des créneaux existants (enum -> shift par défaut)
UPDATE "PlanningCreneau" SET "shiftId" = CASE "creneau"::text
  WHEN 'MATIN' THEN 'shift_matin'
  WHEN 'APRES_MIDI' THEN 'shift_apresmidi'
  WHEN 'SOIR' THEN 'shift_soir'
  WHEN 'NUIT' THEN 'shift_nuit'
  WHEN 'REPOS' THEN 'shift_repos'
  WHEN 'CONGE' THEN 'shift_conge'
  WHEN 'FERIE' THEN 'shift_ferie'
END;

-- Finalisation : NOT NULL + clé étrangère
ALTER TABLE "PlanningCreneau" ALTER COLUMN "shiftId" SET NOT NULL;
ALTER TABLE "PlanningCreneau" ADD CONSTRAINT "PlanningCreneau_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Suppression de l'ancienne colonne enum + du type
ALTER TABLE "PlanningCreneau" DROP COLUMN "creneau";
DROP TYPE "CreneauPlanning";
