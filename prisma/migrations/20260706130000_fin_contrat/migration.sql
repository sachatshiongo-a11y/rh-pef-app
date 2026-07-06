-- Fin de contrat + solde de tout compte (loi RDC).
CREATE TABLE "FinContrat" (
  "id"                       TEXT NOT NULL,
  "employeeId"               TEXT NOT NULL,
  "motif"                    TEXT NOT NULL,
  "dateFin"                  DATE NOT NULL,
  "salaireJournalierUSD"     DECIMAL(12,2) NOT NULL,
  "joursTravaillesMois"      INTEGER NOT NULL DEFAULT 0,
  "salaireProrataUSD"        DECIMAL(12,2) NOT NULL DEFAULT 0,
  "joursCongesNonPris"       DECIMAL(6,2) NOT NULL DEFAULT 0,
  "indemniteCongesUSD"       DECIMAL(12,2) NOT NULL DEFAULT 0,
  "preavisJours"             INTEGER NOT NULL DEFAULT 0,
  "indemnitePreavisUSD"      DECIMAL(12,2) NOT NULL DEFAULT 0,
  "indemniteLicenciementUSD" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "autresUSD"                DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalUSD"                 DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commentaire"              TEXT,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "creeParId"                TEXT,
  CONSTRAINT "FinContrat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinContrat_employeeId_idx" ON "FinContrat" ("employeeId");
