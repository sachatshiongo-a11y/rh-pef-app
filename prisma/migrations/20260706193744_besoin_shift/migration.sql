-- Effectif requis par shift × poste × jour de la semaine (pilote la génération auto)
CREATE TABLE "BesoinShift" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "poste" TEXT NOT NULL,
    "jourSemaine" INTEGER NOT NULL,
    "nombreRequis" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BesoinShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BesoinShift_shiftId_poste_jourSemaine_key" ON "BesoinShift"("shiftId", "poste", "jourSemaine");

ALTER TABLE "BesoinShift" ADD CONSTRAINT "BesoinShift_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
