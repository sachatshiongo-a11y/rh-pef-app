# Coordination — plusieurs chantiers en parallèle

Deux sessions de travail poussent vers **le même repo → le même Render → la même base Supabase**.
Pour éviter tout incident (surtout : plan Supabase Free = **pas de PITR**, base non restaurable),
suivre ces règles.

## Règles

1. **Travailler sur une branche**, jamais directement sur `main` (déjà le cas : `feat/stock-achats`).
2. **Fusionner via Pull Request** dans `main`, en laissant la **CI passer** (tsc + tests —
   `.github/workflows/ci.yml`). La CI est le garde-fou automatique avant la prod.
3. **Ne pas déployer les deux chantiers en même temps** (deux `migrate deploy` qui s'entremêlent).
4. **Avant tout déploiement qui touche le schéma / une migration** :
   - tester la migration sur une base jetable : `./scripts/test-migration.sh` ;
   - déployer via `DATABASE_URL=... ./scripts/deploy-safe.sh` (sauvegarde `pg_dump` AVANT le push).

## État de la prod à connaître (fait le 2026-07-07)

- **API Data Supabase DÉSACTIVÉE** (Dashboard → Data API OFF). L'app n'utilise que Prisma
  (connexion directe), Supabase Auth (`/auth/v1/`) et Storage (`/storage/v1/`). Ne pas réintroduire
  de requêtes via l'API REST `/rest/v1/` : elles échoueront.
- **Bucket Storage `employes`** : `allowed_mime_types` = images + PDF + Word + Excel ; limite 15 Mo.
  Tout nouvel import de document doit rester dans ces types.
- **`main` contient déjà** : fiches de poste, tests de paie, CI, export du journal d'audit,
  exports Excel (exceljs), refonte mobile de la paie.

## En cas de migration multi-schémas (module `stock`)

- La base n'a **pas** de sauvegarde automatique : faire un `pg_dump` juste avant (via `deploy-safe.sh`).
- Vérifier que la migration crée bien le schéma (`CREATE SCHEMA IF NOT EXISTS stock`) avant les
  tables `@@schema("stock")`.
- Valider d'abord sur base jetable (`test-migration.sh`) : une base vierge doit accepter TOUTES
  les migrations d'affilée sans erreur.
