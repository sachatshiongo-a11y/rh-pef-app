-- Solde de tout compte : ce que le solde REPREND (audit paie du 2026-10-10).
--
-- Migration ADDITIVE et idempotente : deux colonnes nouvelles, 0 par défaut. Aucune ligne existante
-- n'est réécrite : les soldes déjà archivés gardent leur total à l'identique (ils ne reprenaient rien).
--
--   reprisePretUSD      reste dû des prêts en cours, retranché du solde (le prêt passe SOLDÉ) ;
--   repriseAcomptesUSD  acomptes approuvés qu'aucun bulletin validé ou payé n'a retenus.
-- Le net versé = totalUSD − reprisePretUSD − repriseAcomptesUSD (jamais stocké : dérivé, une seule
-- soustraction). Pas de nouvelle table : la RLS de "FinContrat" s'applique déjà.

ALTER TABLE "public"."FinContrat" ADD COLUMN IF NOT EXISTS "reprisePretUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "public"."FinContrat" ADD COLUMN IF NOT EXISTS "repriseAcomptesUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
