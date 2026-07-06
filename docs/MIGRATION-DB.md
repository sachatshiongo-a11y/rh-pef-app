# Migration de la base de données vers l'Europe (réduire la latence)

La base actuelle est en Oregon (~380 ms par requête depuis Kinshasa). La déplacer en Europe
(~150 ms) rend l'application ~2,5× plus réactive. Supabase ne permet pas de changer la région
d'un projet existant : on crée un nouveau projet et on migre les données.

## Étapes (à faire ensemble)

### 1. Vous : créer le nouveau projet Supabase (Europe)
1. Sur supabase.com → New project.
2. **Region : Europe** (Frankfurt `eu-central-1` ou Ireland `eu-west-1`).
3. Notez le mot de passe de base de données choisi.
4. Récupérez et donnez-moi (Project Settings → API et → Database) :
   - Project URL (`https://xxxx.supabase.co`)
   - `anon` / clé publiable
   - `service_role` (secrète)
   - Connection string **Transaction pooler** (port 6543) → futur `DATABASE_URL`
   - Connection string **Direct connection** (port 5432) → futur `DIRECT_URL`

### 2. Moi : préparer le schéma sur la nouvelle base
```bash
# applique toutes les migrations Prisma sur la nouvelle base (schéma vide → à jour)
DIRECT_URL="<nouveau DIRECT_URL>" DATABASE_URL="<nouveau DATABASE_URL>" \
  npx prisma migrate deploy
```

### 3. Moi : copier les données (comptes + métier), IDs préservés
```bash
ANCIEN_DIRECT_URL="<ancien DIRECT_URL du .env actuel>" \
NOUVEAU_DIRECT_URL="<nouveau DIRECT_URL>" \
  npx tsx scripts/migrer-vers-nouvelle-db.ts
```
Le script copie `auth.users` (connexions + mots de passe) puis toutes les tables métier dans
l'ordre des dépendances, en préservant les identifiants (les relations d'audit/paie restent valides).

### 4. Moi : basculer l'application
- Mettre à jour `.env` avec les 5 nouvelles valeurs.
- `npm run build` puis redémarrer le serveur de production.
- Vérifier : connexion, employés, calcul de paie, bulletins.

### 5. Vérification et bascule définitive
- Tester quelques pages et comparer un bulletin avant/après.
- Une fois validé, l'ancien projet Oregon peut être supprimé (garder 1-2 semaines par prudence).

## Note
Les mesures : ancienne base ~380 ms/requête, cible Europe ~150 ms. Le gain se cumule sur chaque
page (plusieurs requêtes). Le calcul de paie a déjà été optimisé (100 → ~8 requêtes).
