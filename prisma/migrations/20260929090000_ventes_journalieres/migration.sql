-- Ventes journalières du restaurant (Conso. journalière → Ventes ; fiche « Rapport journalier
-- cuisine et bar », 2026-09-29). Migration PUREMENT ADDITIVE : une table neuve, rien d'existant
-- n'est modifié.
-- Une ligne = le nombre vendu d'UNE unité de vente (fiche technique « Plat vendu » ou fiche Bar)
-- un jour donné. Pas de ligne = pas de saisie ; quantite = 0 = « rien vendu », saisi.

-- CreateTable
CREATE TABLE "stock"."VenteJournaliere" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ficheId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "saisiParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenteJournaliere_pkey" PRIMARY KEY ("id"),
    -- Un nombre vendu n'est jamais négatif.
    CONSTRAINT "VenteJournaliere_quantite_check" CHECK ("quantite" >= 0)
);

-- CreateIndex
CREATE INDEX "VenteJournaliere_ficheId_idx" ON "stock"."VenteJournaliere"("ficheId");

-- CreateIndex (une seule saisie par (jour, fiche))
CREATE UNIQUE INDEX "VenteJournaliere_date_ficheId_key" ON "stock"."VenteJournaliere"("date", "ficheId");

-- AddForeignKey (RESTRICT : une fiche qui porte des ventes ne se supprime pas)
ALTER TABLE "stock"."VenteJournaliere" ADD CONSTRAINT "VenteJournaliere_ficheId_fkey" FOREIGN KEY ("ficheId") REFERENCES "stock"."FicheTechnique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout.
ALTER TABLE "stock"."VenteJournaliere" ENABLE ROW LEVEL SECURITY;

-- Libellé et rang d'une fiche dans le « Rapport journalier » (posés par l'import du classeur de la
-- Direction). Colonnes NOUVELLES et NULLABLES : aucune ligne existante n'est modifiée.
ALTER TABLE "stock"."FicheTechnique" ADD COLUMN "libelleVente" TEXT;
ALTER TABLE "stock"."FicheTechnique" ADD COLUMN "ordreVente" INTEGER;

-- Nom court d'un article du catalogue, imprimé sur la fiche « Commande journalière ». Colonne
-- NOUVELLE et NULLABLE : aucune ligne existante n'est modifiée.
ALTER TABLE "stock"."ArticleStock" ADD COLUMN "nomCourt" TEXT;

-- Fiche « Commande journalière » sur le modèle du classeur : article coché, rang et rubrique du
-- classeur. Colonnes NOUVELLES (booléen à false par défaut, les autres NULLABLES) : aucune ligne
-- existante n'est modifiée.
ALTER TABLE "stock"."ArticleStock" ADD COLUMN "surFicheCommande" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stock"."ArticleStock" ADD COLUMN "ordreCommande" INTEGER;
ALTER TABLE "stock"."ArticleStock" ADD COLUMN "rubriqueCommande" TEXT;
