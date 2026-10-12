-- Un article du restaurant peut être rattaché à PLUSIEURS articles du catalogue (demande de Sacha,
-- 2026-10-12 : plusieurs marques de beurre, de lait, de crème…). Migration ADDITIVE : une table de
-- liaison NEUVE ; la colonne "ArticleResto"."articleStockId" est CONSERVÉE (l'ancien code, encore en
-- ligne pendant le déploiement, la lit) — le nouveau code ne la lit ni ne l'écrit plus ; elle sera
-- retirée dans une version suivante. Chaque lien existant est RECOPIÉ dans la table de liaison.

-- CreateTable
CREATE TABLE IF NOT EXISTS "stock"."ArticleRestoStock" (
    "id" TEXT NOT NULL,
    "articleRestoId" TEXT NOT NULL,
    "articleStockId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleRestoStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (un couple n'existe qu'une fois)
CREATE UNIQUE INDEX IF NOT EXISTS "ArticleRestoStock_articleRestoId_articleStockId_key" ON "stock"."ArticleRestoStock"("articleRestoId", "articleStockId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ArticleRestoStock_articleStockId_idx" ON "stock"."ArticleRestoStock"("articleStockId");

-- AddForeignKey (CASCADE : supprimer l'un ou l'autre retire le lien, comme l'ancien SET NULL)
DO $$ BEGIN
  ALTER TABLE "stock"."ArticleRestoStock" ADD CONSTRAINT "ArticleRestoStock_articleRestoId_fkey" FOREIGN KEY ("articleRestoId") REFERENCES "stock"."ArticleResto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "stock"."ArticleRestoStock" ADD CONSTRAINT "ArticleRestoStock_articleStockId_fkey" FOREIGN KEY ("articleStockId") REFERENCES "stock"."ArticleStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout ; les
-- privilèges par défaut des rôles anon / authenticated sont déjà retirés par cette migration.
ALTER TABLE "stock"."ArticleRestoStock" ENABLE ROW LEVEL SECURITY;

-- Recopie des liens existants (un par article du restaurant rattaché). Idempotente : rejouable après
-- le déploiement pour rattraper un lien posé par l'ancien code pendant la bascule.
INSERT INTO "stock"."ArticleRestoStock" ("id", "articleRestoId", "articleStockId")
SELECT gen_random_uuid()::text, r."id", r."articleStockId"
FROM "stock"."ArticleResto" r
WHERE r."articleStockId" IS NOT NULL
ON CONFLICT ("articleRestoId", "articleStockId") DO NOTHING;
