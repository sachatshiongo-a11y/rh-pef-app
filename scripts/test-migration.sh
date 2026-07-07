#!/usr/bin/env bash
#
# TESTE toutes les migrations Prisma sur une base Postgres JETABLE (Docker) — JAMAIS la prod.
# À lancer avant de déployer une migration sensible (ex. le module Stock et son schéma `stock`) :
# si `prisma migrate deploy` plante, on le voit ici, sans aucun risque pour les données réelles.
#
#   ./scripts/test-migration.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker n'est pas installé. Installe Docker Desktop (https://www.docker.com/products/docker-desktop/)"
  echo "puis relance ce script. (Alternative : pointe DATABASE_URL vers une base Postgres locale vide"
  echo "et lance directement 'npx prisma migrate deploy'.)"
  exit 1
fi

PORT="${PORT:-5433}"
NAME="rhpef-migtest"

echo "▶ Démarrage d'une base Postgres 17 jetable (Docker, port $PORT)…"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run --name "$NAME" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rhpef -p "$PORT:5432" -d postgres:17 >/dev/null

cleanup() { echo "▶ Nettoyage de la base jetable…"; docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▶ Attente que la base soit prête…"
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

export DATABASE_URL="postgresql://postgres:test@localhost:$PORT/rhpef"
echo "▶ Application de TOUTES les migrations (prisma migrate deploy) sur la base neuve…"
if npx prisma migrate deploy; then
  echo
  echo "✓ SUCCÈS : toutes les migrations passent proprement sur une base vierge."
  echo "  → La migration peut être déployée en prod (via ./scripts/deploy-safe.sh)."
else
  echo
  echo "✗ ÉCHEC : une migration a planté (voir l'erreur ci-dessus)."
  echo "  → NE PAS déployer en prod tant que ce n'est pas corrigé."
  exit 1
fi
