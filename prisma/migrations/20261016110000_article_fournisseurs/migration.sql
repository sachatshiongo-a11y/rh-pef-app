-- Plusieurs fournisseurs par article (2026-10-16, demande de la Direction : « un article peut avoir plusieurs
-- fournisseurs », avec un fournisseur HABITUEL marqué). Migration ADDITIVE et IDEMPOTENTE : une table NEUVE
-- `stock.ArticleFournisseur`, remplie à partir de ce que la base sait déjà. Aucune colonne existante n'est
-- modifiée ni supprimée : `ArticleStock.fournisseurId` reste, comme copie du fournisseur habituel, pour que le
-- code d'avant la bascule continue de fonctionner (à retirer à la version suivante). Aucun montant, aucune
-- quantité de stock n'est touché.

-- CreateTable
CREATE TABLE IF NOT EXISTS "stock"."ArticleFournisseur" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "fournisseurId" TEXT NOT NULL,
    "habituel" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'MANUEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ArticleFournisseur_fournisseurId_idx" ON "stock"."ArticleFournisseur"("fournisseurId");

-- CreateIndex (un couple article/fournisseur n'existe qu'une fois)
CREATE UNIQUE INDEX IF NOT EXISTS "ArticleFournisseur_articleId_fournisseurId_key" ON "stock"."ArticleFournisseur"("articleId", "fournisseurId");

-- AU PLUS UN fournisseur habituel par article : index unique PARTIEL (Prisma ne sait pas le décrire ; il l'ignore
-- à la comparaison du schéma, comme les contraintes CHECK des migrations précédentes).
CREATE UNIQUE INDEX IF NOT EXISTS "ArticleFournisseur_un_habituel_key" ON "stock"."ArticleFournisseur"("articleId") WHERE "habituel";

-- AddForeignKey (rejouable : ajoutée seulement si elle n'existe pas)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ArticleFournisseur_articleId_fkey') THEN
    ALTER TABLE "stock"."ArticleFournisseur" ADD CONSTRAINT "ArticleFournisseur_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "stock"."ArticleStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ArticleFournisseur_fournisseurId_fkey') THEN
    ALTER TABLE "stock"."ArticleFournisseur" ADD CONSTRAINT "ArticleFournisseur_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "stock"."Fournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout. Aucun droit à
-- anon/authenticated : redit ici, sans échec si ces rôles n'existent pas (base locale).
ALTER TABLE "stock"."ArticleFournisseur" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "stock"."ArticleFournisseur" FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ── Reprise de l'existant (idempotente : ON CONFLICT DO NOTHING, un 2e passage n'ajoute rien) ─────────────────

-- 1. Le fournisseur de la fiche article d'aujourd'hui devient le fournisseur HABITUEL.
INSERT INTO "stock"."ArticleFournisseur" ("id", "articleId", "fournisseurId", "habituel", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, a."id", a."fournisseurId", true, 'HISTORIQUE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "stock"."ArticleStock" a
WHERE a."fournisseurId" IS NOT NULL
ON CONFLICT ("articleId", "fournisseurId") DO NOTHING;

-- 2. Les fournisseurs déjà VUS dans l'historique, non habituels (aucun habituel n'est inventé) : lignes de
--    facture rattachées à un article d'une facture au fournisseur connu ; achats directs de la Liste d'achat ;
--    lignes d'un bon de commande engagé (ni brouillon ni annulé). `createdAt` = la plus ancienne date vue.
INSERT INTO "stock"."ArticleFournisseur" ("id", "articleId", "fournisseurId", "habituel", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v."articleId", v."fournisseurId", false, 'HISTORIQUE', v."vuLe", CURRENT_TIMESTAMP
FROM (
  SELECT l."articleId", f."fournisseurId", COALESCE(MIN(f."date")::timestamp, CURRENT_TIMESTAMP) AS "vuLe"
  FROM "stock"."LigneFacture" l
  JOIN "stock"."FactureFournisseur" f ON f."id" = l."factureId"
  WHERE l."articleId" IS NOT NULL AND f."fournisseurId" IS NOT NULL
  GROUP BY l."articleId", f."fournisseurId"
) v
ON CONFLICT ("articleId", "fournisseurId") DO NOTHING;

INSERT INTO "stock"."ArticleFournisseur" ("id", "articleId", "fournisseurId", "habituel", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v."articleId", v."fournisseurId", false, 'HISTORIQUE', v."vuLe", CURRENT_TIMESTAMP
FROM (
  SELECT m."articleId", m."fournisseurId", COALESCE(MIN(m."date")::timestamp, CURRENT_TIMESTAMP) AS "vuLe"
  FROM "stock"."MouvementStock" m
  WHERE m."type" = 'ENTREE' AND m."fournisseurId" IS NOT NULL
  GROUP BY m."articleId", m."fournisseurId"
) v
ON CONFLICT ("articleId", "fournisseurId") DO NOTHING;

INSERT INTO "stock"."ArticleFournisseur" ("id", "articleId", "fournisseurId", "habituel", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v."articleId", v."fournisseurId", false, 'HISTORIQUE', v."vuLe", CURRENT_TIMESTAMP
FROM (
  SELECT l."articleId", b."fournisseurId", COALESCE(MIN(b."date")::timestamp, CURRENT_TIMESTAMP) AS "vuLe"
  FROM "stock"."LigneBonDeCommande" l
  JOIN "stock"."BonDeCommande" b ON b."id" = l."bonDeCommandeId"
  WHERE l."articleId" IS NOT NULL AND b."fournisseurId" IS NOT NULL AND b."statut" IN ('VALIDE', 'ENVOYE', 'RECU_PARTIEL', 'RECU')
  GROUP BY l."articleId", b."fournisseurId"
) v
ON CONFLICT ("articleId", "fournisseurId") DO NOTHING;
