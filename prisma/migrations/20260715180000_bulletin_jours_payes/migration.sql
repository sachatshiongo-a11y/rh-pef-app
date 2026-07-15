-- Scission de la ligne « Salaire de base » du bulletin : part heures travaillées / part jours
-- payés non travaillés (congés, fériés, repos valorisés à la journée). Champs additifs ; les
-- lignes non figées se remplissent au prochain recalcul automatique.
ALTER TABLE "public"."PayrollLine" ADD COLUMN "joursPayesNonTravailles" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."PayrollLine" ADD COLUMN "remunerationJoursPayesUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
