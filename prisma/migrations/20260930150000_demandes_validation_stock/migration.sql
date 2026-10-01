-- Demandes soumises à la validation de la Direction dans l'espace Stock (2026-09-30) : paiement de
-- facture, réconciliation du stock, modification d'un article. Migration PUREMENT ADDITIVE : deux
-- énumérations et deux tables NEUVES dans le schéma `stock`. Aucune table existante n'est modifiée,
-- aucune donnée n'est réécrite. Tant qu'aucune demande n'existe, rien ne change.

-- CreateEnum
CREATE TYPE "stock"."NatureDemandeStock" AS ENUM ('PAIEMENT_FACTURE', 'RECONCILIATION', 'MODIF_ARTICLE');

-- CreateEnum
CREATE TYPE "stock"."StatutDemandeStock" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REFUSEE', 'ANNULEE');

-- CreateTable
CREATE TABLE "stock"."DemandeValidationStock" (
    "id" TEXT NOT NULL,
    "nature" "stock"."NatureDemandeStock" NOT NULL,
    "statut" "stock"."StatutDemandeStock" NOT NULL DEFAULT 'EN_ATTENTE',
    "resume" TEXT NOT NULL,
    "charge" JSONB NOT NULL,
    "auteurId" TEXT NOT NULL,
    "auteurNom" TEXT NOT NULL,
    "decideurId" TEXT,
    "decideurNom" TEXT,
    "decideLe" TIMESTAMP(3),
    "motifRefus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandeValidationStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable : une ligne par cible d'une demande EN ATTENTE (« FACTURE:<id> », « ARTICLE:<id> »,
-- « COMPTAGE:<articleId> »). La clé primaire interdit deux demandes en attente sur la même cible ;
-- les lignes disparaissent quand la demande est décidée ou retirée.
CREATE TABLE "stock"."CibleDemandeStock" (
    "cle" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,

    CONSTRAINT "CibleDemandeStock_pkey" PRIMARY KEY ("cle")
);

-- CreateIndex
CREATE INDEX "DemandeValidationStock_statut_nature_createdAt_idx" ON "stock"."DemandeValidationStock"("statut", "nature", "createdAt");

-- CreateIndex
CREATE INDEX "DemandeValidationStock_auteurId_statut_idx" ON "stock"."DemandeValidationStock"("auteurId", "statut");

-- CreateIndex
CREATE INDEX "CibleDemandeStock_demandeId_idx" ON "stock"."CibleDemandeStock"("demandeId");

-- AddForeignKey
ALTER TABLE "stock"."CibleDemandeStock" ADD CONSTRAINT "CibleDemandeStock_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "stock"."DemandeValidationStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout.
ALTER TABLE "stock"."DemandeValidationStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock"."CibleDemandeStock" ENABLE ROW LEVEL SECURITY;
