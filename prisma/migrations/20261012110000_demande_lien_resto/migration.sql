-- Décision de la Direction (2026-10-12) : rattacher ou détacher un article du catalogue à un article du
-- restaurant, par un autre compte que la Direction, devient une demande à valider (« les autres rôles
-- modifient, la Direction valide »). Migration PUREMENT ADDITIVE : une valeur NOUVELLE dans l'énumération
-- des natures de demande. Aucune ligne existante n'est touchée. Migration séparée de la table de liaison
-- (20261012100000) : un ALTER TYPE ... ADD VALUE ne se mélange pas à ce qui l'utilise.
ALTER TYPE "stock"."NatureDemandeStock" ADD VALUE 'LIEN_RESTO';
-- Même jour : aligner l'unité d'un article du restaurant sur celle de l'Inventaire (une seule unité par produit),
-- par un autre compte que la Direction = une demande à valider.
ALTER TYPE "stock"."NatureDemandeStock" ADD VALUE 'UNITE_RESTO';
