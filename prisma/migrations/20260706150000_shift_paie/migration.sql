-- Un shift/rôle peut porter sa propre durée et son propre taux horaire (paie multi-rôles).
ALTER TABLE "Shift" ADD COLUMN "dureeHeures" DECIMAL(5,2);
ALTER TABLE "Shift" ADD COLUMN "tauxHoraireUSD" DECIMAL(12,4);
