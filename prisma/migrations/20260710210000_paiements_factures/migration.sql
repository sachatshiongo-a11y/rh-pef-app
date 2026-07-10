-- Paiements (totaux ou partiels) datés sur les factures fournisseurs
CREATE TABLE "stock"."Paiement" (
    "id" TEXT NOT NULL,
    "factureId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "montantUSD" DECIMAL(14,2) NOT NULL,
    "modePaiement" TEXT,
    "note" TEXT,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Paiement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Paiement_factureId_idx" ON "stock"."Paiement"("factureId");

ALTER TABLE "stock"."Paiement" ADD CONSTRAINT "Paiement_factureId_fkey" FOREIGN KEY ("factureId") REFERENCES "stock"."FactureFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
