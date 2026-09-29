-- Solde de congé FIGÉ à l'approbation d'une demande (décision Direction 2026-09-29).
-- Migration PUREMENT ADDITIVE : quatre colonnes NOUVELLES et nullables sur "LeaveRequest". Aucune
-- colonne existante n'est modifiée, aucune donnée n'est réécrite : les demandes approuvées avant ce
-- changement gardent un instantané vide (null) et le PDF l'annonce comme le solde du jour d'édition
-- (règle maison : pas de rétro-simulation). La table a déjà sa RLS : rien à y changer.

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "soldeFigeAcquis" DECIMAL(6,2),
ADD COLUMN     "soldeFigeJours" DECIMAL(6,2),
ADD COLUMN     "soldeFigeLe" TIMESTAMP(3),
ADD COLUMN     "soldeFigePris" DECIMAL(6,2);
