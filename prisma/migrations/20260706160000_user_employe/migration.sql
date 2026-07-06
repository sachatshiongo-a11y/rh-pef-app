-- Lien optionnel entre un compte utilisateur et une fiche employé (même personne).
ALTER TABLE "User" ADD COLUMN "employeeId" TEXT;
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
