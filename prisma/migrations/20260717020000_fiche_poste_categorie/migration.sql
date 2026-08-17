-- Catégorie professionnelle (classe RDC) au niveau du poste, pour le générateur de fiche.
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "categorieProfessionnelle" TEXT;
