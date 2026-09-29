-- Ventes journalières du restaurant (Conso. journalière → Ventes ; fiche « Rapport journalier
-- cuisine et bar », 2026-09-29). Migration PUREMENT ADDITIVE : une table neuve, rien d'existant
-- n'est modifié.
-- Une ligne = le nombre vendu d'UN plat (fiche technique) OU d'UNE boisson (article du bar) un
-- jour donné. Pas de ligne = pas de saisie ; quantite = 0 = « rien vendu », saisi.

-- CreateTable
CREATE TABLE "stock"."VenteJournaliere" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ficheId" TEXT,
    "articleRestoId" TEXT,
    "quantite" INTEGER NOT NULL,
    "saisiParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenteJournaliere_pkey" PRIMARY KEY ("id"),
    -- Exactement une ligne vendue : un plat OU une boisson, jamais les deux, jamais aucune.
    CONSTRAINT "VenteJournaliere_une_ligne_check" CHECK (("ficheId" IS NULL) <> ("articleRestoId" IS NULL)),
    -- Un nombre vendu n'est jamais négatif.
    CONSTRAINT "VenteJournaliere_quantite_check" CHECK ("quantite" >= 0)
);

-- CreateIndex
CREATE INDEX "VenteJournaliere_ficheId_idx" ON "stock"."VenteJournaliere"("ficheId");

-- CreateIndex
CREATE INDEX "VenteJournaliere_articleRestoId_idx" ON "stock"."VenteJournaliere"("articleRestoId");

-- CreateIndex (unicité (jour, plat) ; les NULL ne se heurtent pas entre eux en PostgreSQL)
CREATE UNIQUE INDEX "VenteJournaliere_date_ficheId_key" ON "stock"."VenteJournaliere"("date", "ficheId");

-- CreateIndex (unicité (jour, boisson))
CREATE UNIQUE INDEX "VenteJournaliere_date_articleRestoId_key" ON "stock"."VenteJournaliere"("date", "articleRestoId");

-- AddForeignKey
ALTER TABLE "stock"."VenteJournaliere" ADD CONSTRAINT "VenteJournaliere_ficheId_fkey" FOREIGN KEY ("ficheId") REFERENCES "stock"."FicheTechnique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."VenteJournaliere" ADD CONSTRAINT "VenteJournaliere_articleRestoId_fkey" FOREIGN KEY ("articleRestoId") REFERENCES "stock"."ArticleResto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout.
ALTER TABLE "stock"."VenteJournaliere" ENABLE ROW LEVEL SECURITY;
