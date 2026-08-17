-- Fiches techniques (recettes) → coût de revient, module Stock.
-- CreateEnum
CREATE TYPE "stock"."TypeFiche" AS ENUM ('PLAT', 'BAR');

-- CreateTable
CREATE TABLE "stock"."FicheTechnique" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "categorie" TEXT,
    "type" "stock"."TypeFiche" NOT NULL DEFAULT 'PLAT',
    "nbPortions" INTEGER NOT NULL DEFAULT 1,
    "tauxTVA" DECIMAL(5,4) NOT NULL DEFAULT 0.16,
    "prixVenteTTC" DECIMAL(12,4),
    "coefficientMargeCible" DECIMAL(8,4),
    "estSousRecette" BOOLEAN NOT NULL DEFAULT false,
    "rendementQuantite" DECIMAL(14,3),
    "rendementUnite" TEXT,
    "recette" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FicheTechnique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."IngredientFiche" (
    "id" TEXT NOT NULL,
    "ficheId" TEXT NOT NULL,
    "articleId" TEXT,
    "sousFicheId" TEXT,
    "unite" TEXT NOT NULL,
    "quantite" DECIMAL(14,3) NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IngredientFiche_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngredientFiche_ficheId_idx" ON "stock"."IngredientFiche"("ficheId");

-- CreateIndex
CREATE INDEX "IngredientFiche_articleId_idx" ON "stock"."IngredientFiche"("articleId");

-- CreateIndex
CREATE INDEX "IngredientFiche_sousFicheId_idx" ON "stock"."IngredientFiche"("sousFicheId");

-- AddForeignKey
ALTER TABLE "stock"."IngredientFiche" ADD CONSTRAINT "IngredientFiche_ficheId_fkey" FOREIGN KEY ("ficheId") REFERENCES "stock"."FicheTechnique"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."IngredientFiche" ADD CONSTRAINT "IngredientFiche_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "stock"."ArticleStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."IngredientFiche" ADD CONSTRAINT "IngredientFiche_sousFicheId_fkey" FOREIGN KEY ("sousFicheId") REFERENCES "stock"."FicheTechnique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Défense en profondeur : RLS activée SANS policy, patron identique à 20260717090000_rls_tables_restantes
-- et 20260812120100_exploitation_module. Le rôle applicatif (postgres, BYPASSRLS) n'est pas affecté ;
-- cela bloque tout accès direct via l'API Data Supabase (rôle anon/authenticated) faute de policy permissive.
ALTER TABLE "stock"."FicheTechnique" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock"."IngredientFiche" ENABLE ROW LEVEL SECURITY;
