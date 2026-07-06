-- Les taux et barèmes ont migré vers ParametreLegal (versionnés par exercice) : on retire
-- les colonnes légales de Config et l'ancienne table IprTranche.
ALTER TABLE "Config" DROP COLUMN IF EXISTS "joursOuvrablesMois";
ALTER TABLE "Config" DROP COLUMN IF EXISTS "droitsCongesAnnuel";
ALTER TABLE "Config" DROP COLUMN IF EXISTS "cnssTauxSalarie";
ALTER TABLE "Config" DROP COLUMN IF EXISTS "cnssTauxPatronal";
ALTER TABLE "Config" DROP COLUMN IF EXISTS "allocFamilialeParEnfant";

DROP TABLE IF EXISTS "IprTranche";
