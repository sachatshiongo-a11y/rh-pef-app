-- Décisions de la Direction du 2026-10-12 sur la paie (règles 3, 4, 5 du questionnaire).
--
-- Migration PUREMENT ADDITIVE et idempotente : des colonnes NOUVELLES, nulles ou à 0 par défaut.
-- Aucune ligne existante n'est réécrite : un bulletin déjà validé ou payé garde ses montants ; une
-- présence « M » existante est « non justifiée » (payée aux 2/3, la règle d'avant pour la brigade).
-- Pas de nouvelle table : la RLS de "Attendance" et "PayrollLine" s'applique déjà.

-- Maladie (TOUT le personnel) : un jour M justifié AU PRÉALABLE par un certificat médical est payé
-- à 100 %, sans justificatif aux 2/3. Pièce jointe facultative (bucket privé « employes »).
ALTER TABLE "public"."Attendance" ADD COLUMN IF NOT EXISTS "maladieJustifiee" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."Attendance" ADD COLUMN IF NOT EXISTS "justificatifUrl" TEXT;

-- Back-office et stagiaires : retenue 1/26e par jour N ou S, prorata des jours ouvrables à l'entrée
-- ou à la sortie en cours de mois, retenue d'un tiers de journée par jour M non justifié. Recopiés
-- sur la ligne pour que le bulletin les imprime en lignes distinctes (nombre de jours, montant).
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "joursAbsenceRetenus" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "retenueAbsencesUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "joursMaladieJustifies" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "joursMaladieNonJustifies" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "retenueMaladieUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
-- Brigade : part des « jours payés non travaillés » due aux jours M justifiés (payés 100 %), imprimée à part.
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "remunerationMaladieJustifieeUSD" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "prorataJoursTravailles" INTEGER;
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "prorataJoursMois" INTEGER;

-- Taux de change FIGÉ à la validation : un bulletin validé ou payé s'imprime (et se déclare) à ce
-- taux, plus jamais au taux du jour réécrit sur la paie du mois. NULL = ligne non figée, ou figée
-- avant cette migration (elle garde alors le taux de la paie du mois, comme avant : la reprise des
-- lignes déjà figées est une décision de la Direction, elle n'est PAS faite ici).
ALTER TABLE "public"."PayrollLine" ADD COLUMN IF NOT EXISTS "tauxChangeFige" DECIMAL(10,2);
