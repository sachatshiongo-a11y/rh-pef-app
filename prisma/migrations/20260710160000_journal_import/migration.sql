-- Journal d'import réversible (inventaire, factures)
CREATE TABLE "stock"."ImportBatch" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "statut" TEXT NOT NULL DEFAULT 'APPLIQUE',
    "resume" JSONB,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "annuleeAt" TIMESTAMP(3),
    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock"."ImportOperation" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "avant" JSONB,
    CONSTRAINT "ImportOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportBatch_type_createdAt_idx" ON "stock"."ImportBatch"("type", "createdAt");
CREATE INDEX "ImportOperation_batchId_idx" ON "stock"."ImportOperation"("batchId");

ALTER TABLE "stock"."ImportOperation" ADD CONSTRAINT "ImportOperation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "stock"."ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
