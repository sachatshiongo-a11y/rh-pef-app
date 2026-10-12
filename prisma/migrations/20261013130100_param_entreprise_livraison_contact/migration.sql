-- Bon de commande (PDF) : « Adresse de livraison » et « Contact » de l'acheteur, saisis dans Paramètres
-- (identité de l'entreprise, Direction). Facultatifs ; additif et rejouable.
ALTER TABLE "public"."ParamEntreprise" ADD COLUMN IF NOT EXISTS "adresseLivraison" TEXT;
ALTER TABLE "public"."ParamEntreprise" ADD COLUMN IF NOT EXISTS "contactAchats" TEXT;
