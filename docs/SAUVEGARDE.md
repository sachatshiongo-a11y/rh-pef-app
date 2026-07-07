# Sauvegarde & restauration — RH PEF

## État actuel (à connaître)

Le projet Supabase **RH PEF** (`udhfuafpnwcwwlgptqzu`, région eu-west-3) est sur le **plan Free**.

Conséquence importante : le plan Free **ne fournit ni sauvegardes automatiques restaurables, ni
PITR** (Point-In-Time Recovery). En cas d'erreur humaine (suppression), de corruption ou de
problème côté hébergeur, **les données de paie ne sont pas récupérables** par défaut.

## Deux options

### Option A — Sauvegarde gratuite par `pg_dump` (stopgap, sans upgrade)

Le script [`scripts/backup-db.sh`](../scripts/backup-db.sh) génère un dump compressé et horodaté.

```bash
# La chaîne DATABASE_URL est celle de Supabase (Settings → Database → Connection string, mode
# "Session"/5432). Elle contient un mot de passe : ne la commite jamais.
DATABASE_URL="postgresql://...:...@db.udhfuafpnwcwwlgptqzu.supabase.co:5432/postgres" \
  ./scripts/backup-db.sh
```

Automatiser sur le Mac (tous les jours à 20h) avec `launchd` ou `cron` :

```cron
0 20 * * *  DATABASE_URL="postgresql://..."  /chemin/vers/rh-pef-app/scripts/backup-db.sh
```

⚠️ Un dump contient toutes les données (salaires, PII). À stocker dans un endroit **sûr et
chiffré** (disque perso chiffré, pas un cloud public en clair).

### Option B — Upgrade Supabase Pro (vraies sauvegardes + PITR)

Plan **Pro** (~25 $/mois) : sauvegardes quotidiennes automatiques avec 7 jours de rétention.
Add-on **PITR** (payant en plus) : restauration à la seconde près.
➡️ Décision de facturation : **à faire par toi** depuis le tableau de bord Supabase
(Organization → Billing). Je ne provisionne pas de ressource payante.

## Tester une restauration — SANS TOUCHER À LA PROD

Ne jamais « tester » une restauration sur la base de production. Procédure sûre :

1. Créer une base Postgres **jetable** (Docker en local) :
   ```bash
   docker run --name rhtest -e POSTGRES_PASSWORD=test -p 5433:5432 -d postgres:17
   ```
2. Restaurer le dump dedans :
   ```bash
   gunzip -c ~/Sauvegardes-RH-PEF/rh-pef_XXXX.sql.gz | \
     psql "postgresql://postgres:test@localhost:5433/postgres"
   ```
3. Vérifier que les tables clés contiennent les données attendues :
   ```bash
   psql "postgresql://postgres:test@localhost:5433/postgres" \
     -c 'SELECT count(*) FROM "Employee";' \
     -c 'SELECT count(*) FROM "PayrollLine";'
   ```
4. Supprimer la base de test : `docker rm -f rhtest`.

Faire cet exercice **une fois** valide que les dumps sont réellement exploitables.

## Sécurité base de données (à traiter)

`get_advisors` (Supabase) signale **RLS désactivé sur toutes les tables** `public`. L'app accède à
la base via Prisma en connexion directe (pas via l'API PostgREST), mais l'API Data de Supabase est
activée par défaut. Deux corrections possibles (à autoriser explicitement, ce sont des changements
sur la prod) :

- **Désactiver l'API Data** (Settings → API → Data API) puisque l'app n'utilise que Prisma ; ou
- **Activer RLS** sur toutes les tables (sans policy = refus par défaut côté PostgREST ; Prisma en
  connexion directe/owner continue de fonctionner).
