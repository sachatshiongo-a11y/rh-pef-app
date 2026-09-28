-- Liste d'achat : fournisseur facultatif PAR LIGNE (décision Direction 2026-09-28) — migration
-- PUREMENT ADDITIVE. Un achat direct (sans facture ni bon de commande) peut désormais nommer son
-- vendeur ; il apparaît alors sur la fiche du fournisseur. Les mouvements existants restent sans
-- fournisseur (aucun rattachement déduit : c'est un geste de saisie, jamais une supposition).
-- Aucune table créée : la RLS de "MouvementStock" (migration 20260923150000_rls_partout) reste en
-- place, et une colonne n'ouvre aucun droit à anon/authenticated.

-- AlterTable
ALTER TABLE "stock"."MouvementStock" ADD COLUMN "fournisseurId" TEXT;

-- CreateIndex
CREATE INDEX "MouvementStock_fournisseurId_idx" ON "stock"."MouvementStock"("fournisseurId");

-- AddForeignKey
ALTER TABLE "stock"."MouvementStock" ADD CONSTRAINT "MouvementStock_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "stock"."Fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
