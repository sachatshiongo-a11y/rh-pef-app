-- Lot D : primes & acomptes sur salaire.

CREATE TYPE "StatutAcompte" AS ENUM ('EN_ATTENTE', 'APPROUVE', 'REFUSE');

CREATE TABLE "Prime" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "montantUSD" DECIMAL(12,2) NOT NULL,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeParId" TEXT,
    CONSTRAINT "Prime_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Prime_employeeId_annee_mois_idx" ON "Prime"("employeeId", "annee", "mois");
ALTER TABLE "Prime" ADD CONSTRAINT "Prime_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AcompteSalaire" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "montantUSD" DECIMAL(12,2) NOT NULL,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "motif" TEXT,
    "statut" "StatutAcompte" NOT NULL DEFAULT 'EN_ATTENTE',
    "dateDemande" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decideParId" TEXT,
    "dateDecision" TIMESTAMP(3),
    CONSTRAINT "AcompteSalaire_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AcompteSalaire_employeeId_annee_mois_idx" ON "AcompteSalaire"("employeeId", "annee", "mois");
ALTER TABLE "AcompteSalaire" ADD CONSTRAINT "AcompteSalaire_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollLine" ADD COLUMN "primesUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollLine" ADD COLUMN "acompteUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
