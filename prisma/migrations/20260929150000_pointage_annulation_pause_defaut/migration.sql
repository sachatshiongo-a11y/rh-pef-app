-- Pointage automatique au scan de l'affiche (décision de la Direction du 2026-09-29).
-- Migration PUREMENT ADDITIVE : trois colonnes NOUVELLES, aucune colonne existante modifiée, aucune
-- donnée réécrite. Les deux tables ont déjà leur RLS : rien à y changer.
--   • "ScanPointage"."annuleLe" / "annuleParId" (nullables) : « Annuler ce pointage ». Un scan
--     annulé RESTE en base (l'historique n'est jamais effacé) ; le moteur et les écrans l'ignorent.
--   • "Pointage"."pauseParDefaut" (faux par défaut) : la pause de 30 min posée au départ scanné
--     sans pause saisie. Toutes les lignes existantes valent faux : aucune n'a reçu cette pause.

-- AlterTable
ALTER TABLE "public"."Pointage" ADD COLUMN     "pauseParDefaut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."ScanPointage" ADD COLUMN     "annuleLe" TIMESTAMP(3),
ADD COLUMN     "annuleParId" TEXT;

-- AddForeignKey
ALTER TABLE "public"."ScanPointage" ADD CONSTRAINT "ScanPointage_annuleParId_fkey" FOREIGN KEY ("annuleParId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
