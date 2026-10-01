-- Décision de la Direction (2026-10-01) : une entrée ou sortie manuelle hors flux libre (ni
-- « Livraison restaurant », ni « Perte », ni « Retour restaurant ») faite par un autre compte que la
-- Direction devient une demande à valider. Migration PUREMENT ADDITIVE : une valeur NOUVELLE dans
-- l'énumération des natures de demande. Aucune ligne existante n'est touchée.
--
-- Migration séparée plutôt que de compléter 20260930150000 : celle-ci n'est déployée nulle part,
-- mais une migration publiée sur la branche ne se réécrit pas (empreinte Prisma) — une base de
-- recette qui l'aurait déjà jouée refuserait la version modifiée.
ALTER TYPE "stock"."NatureDemandeStock" ADD VALUE 'MOUVEMENT_MANUEL';
