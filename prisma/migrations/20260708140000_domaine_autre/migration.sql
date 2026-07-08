-- Ajoute la valeur AUTRE à l'enum DomaineStock (produits non alimentaires ni boissons).
ALTER TYPE "stock"."DomaineStock" ADD VALUE IF NOT EXISTS 'AUTRE';
