-- PDF figé du contrat au moment de l'acceptation (exemplaire qui fait foi).
ALTER TABLE "public"."Contrat" ADD COLUMN IF NOT EXISTS "pdfAccepteUrl" TEXT;
