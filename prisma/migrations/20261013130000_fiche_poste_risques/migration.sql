-- Rubrique « Risques et contraintes du poste » du modèle Word des fiches de poste. Facultative,
-- propre à chaque poste (une ligne = un risque ou une contrainte) ; saisie dans l'éditeur.
ALTER TABLE "public"."FichePoste" ADD COLUMN IF NOT EXISTS "risquesContraintes" TEXT;
