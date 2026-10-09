-- Factures fournisseurs en francs congolais, au choix (demande de la Direction, 2026-10-09).
--
-- Migration ADDITIVE : des colonnes NOUVELLES, et trois montants en dollars qui DEVIENNENT
-- facultatifs (DROP NOT NULL : aucune ligne n'est réécrite, aucune valeur ne change). Toutes les
-- factures, lignes et paiements existants prennent la devise USD (valeur par défaut) et gardent
-- leurs montants en dollars à l'identique ; leurs colonnes en francs restent NULLES.
--
-- Règle : la devise de saisie FAIT FOI, jamais d'aller-retour. Une facture en francs tient son
-- montant, son réglé et son reste EN FRANCS (colonnes en dollars NULLES) ; une facture en dollars,
-- en dollars (colonnes en francs NULLES). Les contraintes CHECK ci-dessous l'imposent en base.
--
-- Ordre : nommée après 20261009100000_conge_motif_refus (branche feat/conges-ecran) ; les deux
-- migrations sont indépendantes (tables différentes).

-- AlterTable
ALTER TABLE "stock"."FactureFournisseur" ADD COLUMN     "devise" "stock"."DeviseSaisie" NOT NULL DEFAULT 'USD',
ADD COLUMN     "montantCDF" DECIMAL(16,2),
ADD COLUMN     "montantRegleCDF" DECIMAL(16,2),
ADD COLUMN     "resteAPayerCDF" DECIMAL(16,2),
ADD COLUMN     "tauxChangeUtilise" DECIMAL(10,2),
ALTER COLUMN "montantUSD" DROP NOT NULL,
ALTER COLUMN "montantRegleUSD" DROP NOT NULL,
ALTER COLUMN "resteAPayerUSD" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stock"."Paiement" ADD COLUMN     "devise" "stock"."DeviseSaisie" NOT NULL DEFAULT 'USD',
ALTER COLUMN "montantUSD" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stock"."LigneFacture" ADD COLUMN     "prixUnitaireCDF" DECIMAL(16,2),
ADD COLUMN     "totalLigneCDF" DECIMAL(16,2),
ALTER COLUMN "prixUnitaireUSD" DROP NOT NULL,
ALTER COLUMN "totalLigneUSD" DROP NOT NULL;

-- Une facture est TOUT en dollars ou TOUT en francs : jamais un reste en francs sur une facture en
-- dollars, jamais un montant manquant dans sa propre devise.
ALTER TABLE "stock"."FactureFournisseur" ADD CONSTRAINT "FactureFournisseur_devise_check" CHECK (
  ("devise" = 'USD' AND "montantUSD" IS NOT NULL AND "montantRegleUSD" IS NOT NULL AND "resteAPayerUSD" IS NOT NULL
     AND "montantCDF" IS NULL AND "montantRegleCDF" IS NULL AND "resteAPayerCDF" IS NULL AND "tauxChangeUtilise" IS NULL)
  OR
  ("devise" = 'CDF' AND "montantCDF" IS NOT NULL AND "montantRegleCDF" IS NOT NULL AND "resteAPayerCDF" IS NOT NULL
     AND "montantUSD" IS NULL AND "montantRegleUSD" IS NULL AND "resteAPayerUSD" IS NULL)
);

-- Un paiement porte toujours le montant IMPUTÉ dans la devise de sa facture.
ALTER TABLE "stock"."Paiement" ADD CONSTRAINT "Paiement_devise_check" CHECK (
  ("devise" = 'USD' AND "montantUSD" IS NOT NULL) OR ("devise" = 'CDF' AND "montantCDF" IS NOT NULL)
);

-- Une ligne a son prix et son total dans UNE devise (celle de sa facture).
ALTER TABLE "stock"."LigneFacture" ADD CONSTRAINT "LigneFacture_devise_check" CHECK (
  ("prixUnitaireUSD" IS NOT NULL AND "totalLigneUSD" IS NOT NULL AND "prixUnitaireCDF" IS NULL AND "totalLigneCDF" IS NULL)
  OR
  ("prixUnitaireCDF" IS NOT NULL AND "totalLigneCDF" IS NOT NULL AND "prixUnitaireUSD" IS NULL AND "totalLigneUSD" IS NULL)
);
