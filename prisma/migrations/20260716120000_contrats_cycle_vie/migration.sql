-- Cycle de vie des contrats : transformation historisée, prolongations comptées et bornées,
-- intérimaires. Les garde-fous légaux sont des Paramètres légaux (statut « À VALIDER »).
ALTER TYPE "public"."TypeContrat" ADD VALUE IF NOT EXISTS 'INTERIM';
ALTER TYPE "public"."StatutContrat" ADD VALUE IF NOT EXISTS 'TRANSFORME';

ALTER TABLE "public"."Contrat" ADD COLUMN "renouvellements" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."Contrat" ADD COLUMN "agence" TEXT;
ALTER TABLE "public"."Contrat" ADD COLUMN "coutJourUSD" DECIMAL(12,2);

-- Garde-fous par défaut (Code du travail RDC — À VALIDER par un juriste), pour chaque exercice.
INSERT INTO "public"."ParametreLegal" ("exerciceId", "cle", "valeur", "unite", "libelle", "source", "statutValidation", "commentaire", "updatedAt")
SELECT e."id", p.cle, p.valeur, p.unite, p.libelle, p.source, 'A_VALIDER', p.commentaire, now()
FROM "public"."ExerciceFiscal" e
CROSS JOIN (VALUES
  ('cdd_renouvellements_max', 2::decimal, 'nombre', 'CDD — renouvellements maximum', 'Code du travail RDC (art. 40 et s.) — défaut prudent', 'Défaut à faire valider par un juriste'),
  ('cdd_duree_totale_max_mois', 24::decimal, 'mois', 'CDD — durée totale maximale (prolongations comprises)', 'Code du travail RDC (art. 40 et s.) — défaut prudent', 'Défaut à faire valider par un juriste'),
  ('essai_duree_max_mois', 6::decimal, 'mois', 'Période d''essai — durée maximale', 'Code du travail RDC (art. 43) — défaut prudent', 'Défaut à faire valider par un juriste')
) AS p(cle, valeur, unite, libelle, source, commentaire)
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."ParametreLegal" x WHERE x."exerciceId" = e."id" AND x."cle" = p.cle
);
