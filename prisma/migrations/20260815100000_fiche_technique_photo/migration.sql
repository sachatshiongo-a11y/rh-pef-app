-- Photo d'un plat sur sa fiche technique (module Stock).
-- Purement additive : la table existe déjà et porte déjà sa RLS (défense en profondeur, sans
-- policy — cf. 20260814100000_fiches_techniques) ; une colonne nullable n'a rien à reposer.
-- AddColumn
ALTER TABLE "stock"."FicheTechnique" ADD COLUMN "photoUrl" TEXT;
