-- Ajoute la source de pointage « APP » (self-service dans l'application).
-- Séparé de la création de table : PostgreSQL interdit d'utiliser une valeur d'enum
-- nouvellement ajoutée dans la même transaction que son ajout.
ALTER TYPE "public"."SourcePointage" ADD VALUE IF NOT EXISTS 'APP';
