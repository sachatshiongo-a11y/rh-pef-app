#!/usr/bin/env bash
#
# DÉPLOIEMENT SÛR — à utiliser à la place de `git push origin main` pour tout déploiement qui
# touche le schéma / les migrations, TANT que Supabase est en plan Free (pas de PITR ni de
# sauvegarde restaurable). Render applique `prisma migrate deploy` automatiquement à chaque push
# sur main : ce script garantit qu'une SAUVEGARDE existe AVANT que la migration ne touche la prod.
#
# Étapes : 1) affiche les migrations en attente  2) sauvegarde la base (pg_dump)  3) montre les
# commits à déployer  4) demande confirmation puis pousse le HEAD courant sur main.
#
#   DATABASE_URL="postgresql://...:...@db.udhfuafpnwcwwlgptqzu.supabase.co:5432/postgres" \
#     ./scripts/deploy-safe.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Erreur : DATABASE_URL n'est pas défini (chaîne de connexion Supabase, mode Session 5432)." >&2
  exit 1
fi

echo "▶ Migrations Prisma en attente sur la base cible :"
DATABASE_URL="$DATABASE_URL" npx prisma migrate status || true
echo

echo "▶ 1/2 — Sauvegarde de la base AVANT déploiement…"
DATABASE_URL="$DATABASE_URL" ./scripts/backup-db.sh
echo

echo "▶ Commits qui seront déployés (absents de origin/main) :"
git fetch origin main --quiet || true
git log --oneline origin/main..HEAD || echo "  (aucun — HEAD est déjà sur origin/main)"
echo

read -r -p "▶ 2/2 — Pousser HEAD sur main et déclencher le déploiement Render ? [o/N] " reponse
if [[ "${reponse,,}" == "o" ]]; then
  git push origin HEAD:main
  echo "✓ Poussé sur main. Render construit, applique les migrations, puis déploie."
  echo "  La sauvegarde est dans ~/Sauvegardes-RH-PEF/ si un retour arrière est nécessaire."
else
  echo "✗ Annulé — rien n'a été poussé. (La sauvegarde, elle, a bien été réalisée.)"
fi
