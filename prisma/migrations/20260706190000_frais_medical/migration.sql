-- Frais médicaux avec certificat, par mois.
CREATE TABLE "FraisMedical" (
  "id"            TEXT NOT NULL,
  "employeeId"    TEXT NOT NULL,
  "montantUSD"    DECIMAL(12,2) NOT NULL,
  "mois"          INTEGER NOT NULL,
  "annee"         INTEGER NOT NULL,
  "motif"         TEXT,
  "certificatUrl" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "creeParId"     TEXT,
  CONSTRAINT "FraisMedical_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FraisMedical_employeeId_annee_mois_idx" ON "FraisMedical" ("employeeId", "annee", "mois");
ALTER TABLE "FraisMedical" ADD CONSTRAINT "FraisMedical_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
