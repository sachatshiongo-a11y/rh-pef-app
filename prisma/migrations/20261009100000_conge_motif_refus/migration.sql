-- Motif de refus d'une demande de congé (décision de la Direction, 2026-10-09 : refuser exige un motif).
-- Migration PUREMENT ADDITIVE : UNE colonne NOUVELLE, facultative, sur "LeaveRequest". Aucune colonne
-- existante n'est modifiée, aucune donnée n'est réécrite : les demandes déjà refusées gardent un motif
-- vide (affiché « — »), le logiciel n'invente rien. Le motif n'est exigé que pour les refus FUTURS,
-- par les actions de refus (pas par la base).

-- AlterTable
ALTER TABLE "public"."LeaveRequest" ADD COLUMN "motifRefus" TEXT;
