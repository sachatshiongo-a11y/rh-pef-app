-- EMPREINTE DU DERNIER CALCUL de la paie du mois (perf : ne recalculer les bulletins que si une donnée source a changé).
-- Deux colonnes NULLABLES sur "PayrollRun", PUREMENT ADDITIVES et idempotentes : aucune ligne n'est réécrite, le code en
-- production (qui ignore les colonnes) continue de fonctionner.
--   * "empreinteCalcul" : hachage de tout ce que lit le moteur de paie + des lignes écrites (lib/paie-empreinte.ts) ;
--   * "calculeLe"       : instant de ce calcul (garde temporelle : on recalcule de toute façon passé 10 minutes).
-- NULL = jamais enregistrée : la première ouverture de la paie la recalcule, comme avant, puis l'enregistre.
--
-- Pas de nouvelle table : la RLS de "PayrollRun" (migrations 20260712180000 et 20260717090000) et le retrait des
-- privilèges anon / authenticated s'appliquent déjà aux colonnes ajoutées ; rien n'est modifié de ce côté.

-- AlterTable
ALTER TABLE "public"."PayrollRun" ADD COLUMN IF NOT EXISTS "empreinteCalcul" TEXT;
ALTER TABLE "public"."PayrollRun" ADD COLUMN IF NOT EXISTS "calculeLe" TIMESTAMP(3);
