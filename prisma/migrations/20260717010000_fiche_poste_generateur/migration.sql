-- Champs du générateur de fiche de poste (modèle PEF). Tous facultatifs, remplis via l'éditeur.
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "typeContrat" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "echelleSalariale" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "superieurHierarchique" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "tempsTravail" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "competencesTechniques" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "savoirEtre" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "formationsRequises" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "diplomesRequis" TEXT;
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "experiencesExigees" TEXT;
