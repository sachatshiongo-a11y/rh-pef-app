-- Marqueur d'origine des créneaux de planning : distinguer l'auto-généré (✨) du saisi à la main.
ALTER TABLE "PlanningCreneau" ADD COLUMN "genereAuto" BOOLEAN NOT NULL DEFAULT false;
