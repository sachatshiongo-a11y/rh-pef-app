-- Acceptation numérique du contrat par le salarié (« Lu et approuvé », horodatée).
ALTER TABLE "public"."Contrat" ADD COLUMN IF NOT EXISTS "accepteLe" TIMESTAMP(3);
