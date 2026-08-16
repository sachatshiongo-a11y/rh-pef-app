-- Shifts acceptables par poste, dans l'ordre de préférence.
-- Remplace le repli par expression régulière sur le nom des shifts dans la génération auto.

-- CreateTable
CREATE TABLE "public"."ShiftPoste" (
    "id" TEXT NOT NULL,
    "poste" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftPoste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftPoste_poste_idx" ON "public"."ShiftPoste"("poste");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPoste_poste_shiftId_key" ON "public"."ShiftPoste"("poste", "shiftId");

-- AddForeignKey
ALTER TABLE "public"."ShiftPoste" ADD CONSTRAINT "ShiftPoste_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "public"."Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
