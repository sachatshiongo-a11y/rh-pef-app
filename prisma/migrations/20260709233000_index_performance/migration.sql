-- Index de performance (ajouts, non destructifs) sur les chemins les plus fréquents.

-- Catalogues : filtre par domaine + comptage des articles actifs
CREATE INDEX "ArticleStock_domaine_actif_idx" ON "stock"."ArticleStock"("domaine", "actif");
-- Fiche fournisseur : articles pris chez un fournisseur
CREATE INDEX "ArticleStock_fournisseurId_idx" ON "stock"."ArticleStock"("fournisseurId");
-- Planning : requêtes par plage de dates (génération auto, affichage mensuel)
CREATE INDEX "PlanningCreneau_date_idx" ON "public"."PlanningCreneau"("date");
-- Fiche fournisseur + filtre des bons de commande par fournisseur
CREATE INDEX "BonDeCommande_fournisseurId_idx" ON "stock"."BonDeCommande"("fournisseurId");
