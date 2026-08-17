-- Instantané du stock figé au moment de la clôture (inventaire à la date de clôture)
ALTER TABLE "stock"."ClotureStock" ADD COLUMN "snapshot" JSONB;
