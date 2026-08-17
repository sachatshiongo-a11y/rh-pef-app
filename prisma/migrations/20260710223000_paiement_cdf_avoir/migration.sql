-- Paiements : type (PAIEMENT | AVOIR) + montant réellement versé en CDF + taux figé
ALTER TABLE "stock"."Paiement" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'PAIEMENT';
ALTER TABLE "stock"."Paiement" ADD COLUMN "montantCDF" DECIMAL(16,2);
ALTER TABLE "stock"."Paiement" ADD COLUMN "tauxChangeUtilise" DECIMAL(10,2);
