-- Prix de référence d'un article en francs congolais (demande de la Direction, 2026-10-08).
-- Migration PUREMENT ADDITIVE : deux colonnes NOUVELLES sur ArticleStock. Aucune colonne existante
-- n'est modifiée, aucune donnée n'est réécrite : tous les articles existants prennent la devise USD
-- (valeur par défaut) et gardent leur `prixUnitaireUSD` à l'identique — aucun chiffre ne change.
-- `prixOrigineCDF` / `tauxImportCDF` (provenance d'un ancien import, jamais écrits ni lus par le
-- logiciel) ne sont PAS repris comme prix en francs : ils restent tels quels.

-- AlterTable
ALTER TABLE "stock"."ArticleStock" ADD COLUMN "devisePrix" "stock"."DeviseSaisie" NOT NULL DEFAULT 'USD',
ADD COLUMN "prixUnitaireCDF" DECIMAL(16,2);

-- La devise de saisie fait foi : un article en USD n'a pas de prix en francs, un article en francs
-- n'a pas de prix en dollars (l'équivalent se calcule au taux du jour, il ne se stocke jamais).
ALTER TABLE "stock"."ArticleStock" ADD CONSTRAINT "ArticleStock_prix_devise_check"
  CHECK (("devisePrix" = 'USD' AND "prixUnitaireCDF" IS NULL) OR ("devisePrix" = 'CDF' AND "prixUnitaireUSD" IS NULL));
