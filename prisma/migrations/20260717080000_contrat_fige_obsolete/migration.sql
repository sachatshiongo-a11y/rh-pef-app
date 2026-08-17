-- Signale qu'un exemplaire figé ne reflète plus les conditions (corrigées après figeage).
ALTER TABLE "public"."Contrat" ADD COLUMN IF NOT EXISTS "pdfAccepteObsolete" BOOLEAN NOT NULL DEFAULT false;
