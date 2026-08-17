-- Confidentialité des fichiers (contrats, sanctions, documents, photos, preuves, PDF factures/BC) :
-- 1) les URLs publiques stockées en base deviennent des liens applicatifs « /fichiers/<chemin> »,
--    servis par une route authentifiée qui redirige vers une URL signée temporaire ;
-- 2) le bucket « employes » passe en PRIVÉ — les anciennes URLs publiques cessent de fonctionner.

UPDATE "public"."Employee" SET "photoUrl" = regexp_replace("photoUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "photoUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "public"."Contrat" SET "documentUrl" = regexp_replace("documentUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "documentUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "public"."DossierDisciplinaire" SET "documentUrl" = regexp_replace("documentUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "documentUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "public"."Evaluation" SET "documentUrl" = regexp_replace("documentUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "documentUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "public"."DocumentEmploye" SET "fichierUrl" = regexp_replace("fichierUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "fichierUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "public"."FichePoste" SET "fichierUrl" = regexp_replace("fichierUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "fichierUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "public"."TransitionPaie" SET "preuveUrl" = regexp_replace("preuveUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "preuveUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "public"."FraisMedical" SET "certificatUrl" = regexp_replace("certificatUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "certificatUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "stock"."BonDeCommande" SET "documentUrl" = regexp_replace("documentUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "documentUrl" LIKE '%/storage/v1/object/public/employes/%';
UPDATE "stock"."FactureFournisseur" SET "documentUrl" = regexp_replace("documentUrl", '^https?://[^/]+/storage/v1/object/public/employes/', '/fichiers/')
  WHERE "documentUrl" LIKE '%/storage/v1/object/public/employes/%';

-- Bucket privé. Sans blocage du déploiement si le rôle de migration n'a pas le droit sur
-- storage.buckets : dans ce cas, la bascule se fait à la main (Dashboard Supabase → Storage
-- → employes → Public bucket : OFF) — la route /fichiers fonctionne dans les deux cas.
DO $$
BEGIN
  UPDATE storage.buckets SET public = false WHERE id = 'employes';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Bucket « employes » non basculé automatiquement (%) — à faire via le Dashboard.', SQLERRM;
END $$;
