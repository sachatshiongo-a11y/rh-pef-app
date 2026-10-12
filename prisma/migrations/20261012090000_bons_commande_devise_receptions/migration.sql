-- Bons de commande : devise du bon, lignes sans prix, quantités reçues PAR LIGNE (audit du 10/10/2026, stock 2 et 19).
--
-- Migration ADDITIVE : des colonnes NOUVELLES, et trois montants en dollars qui DEVIENNENT facultatifs
-- (DROP NOT NULL : aucune ligne n'est réécrite, aucune valeur ne change). Tous les bons et toutes les
-- lignes existants prennent la devise USD (valeur par défaut) et gardent leurs montants à l'identique ;
-- leurs colonnes en francs restent NULLES, et `quantiteRecue` reste NULLE (le statut du bon seul fait foi
-- pour les bons réceptionnés avant cette date — rien n'est déduit ni inventé).
--
-- Règle : la devise lue FAIT FOI (jamais de conversion au taux du jour). Un bon importé d'un PDF en francs
-- tient son total en francs (`totalCDF`), son `totalUSD` est NUL. Une ligne sans prix a un prix NUL (le
-- total du bon est alors annoncé incomplet) ; les lignes d'avant, saisies sans prix, portent 0 et sont lues
-- comme « sans prix » à l'affichage, sans être réécrites.

-- AlterTable
ALTER TABLE "stock"."BonDeCommande" ADD COLUMN IF NOT EXISTS "devise" "stock"."DeviseSaisie" NOT NULL DEFAULT 'USD',
ALTER COLUMN "totalUSD" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stock"."LigneBonDeCommande" ADD COLUMN IF NOT EXISTS "prixUnitaireCDF" DECIMAL(16,2),
ADD COLUMN IF NOT EXISTS "totalLigneCDF" DECIMAL(16,2),
ADD COLUMN IF NOT EXISTS "quantiteRecue" DECIMAL(14,3),
ALTER COLUMN "prixUnitaireUSD" DROP NOT NULL,
ALTER COLUMN "totalLigneUSD" DROP NOT NULL;

-- Un bon est TOUT en dollars ou TOUT en francs : en dollars il a son total en dollars ; en francs, son total
-- en francs et AUCUN total en dollars.
ALTER TABLE "stock"."BonDeCommande" DROP CONSTRAINT IF EXISTS "BonDeCommande_devise_check";
ALTER TABLE "stock"."BonDeCommande" ADD CONSTRAINT "BonDeCommande_devise_check" CHECK (
  ("devise" = 'USD' AND "totalUSD" IS NOT NULL)
  OR
  ("devise" = 'CDF' AND "totalUSD" IS NULL AND "totalCDF" IS NOT NULL)
);

-- Une ligne ne porte jamais son prix (ni son total) dans les deux devises à la fois.
ALTER TABLE "stock"."LigneBonDeCommande" DROP CONSTRAINT IF EXISTS "LigneBonDeCommande_devise_check";
ALTER TABLE "stock"."LigneBonDeCommande" ADD CONSTRAINT "LigneBonDeCommande_devise_check" CHECK (
  NOT ("prixUnitaireUSD" IS NOT NULL AND "prixUnitaireCDF" IS NOT NULL)
  AND NOT ("totalLigneUSD" IS NOT NULL AND "totalLigneCDF" IS NOT NULL)
);

-- Une quantité reçue n'est jamais négative.
ALTER TABLE "stock"."LigneBonDeCommande" DROP CONSTRAINT IF EXISTS "LigneBonDeCommande_quantiteRecue_check";
ALTER TABLE "stock"."LigneBonDeCommande" ADD CONSTRAINT "LigneBonDeCommande_quantiteRecue_check" CHECK ("quantiteRecue" IS NULL OR "quantiteRecue" >= 0);
