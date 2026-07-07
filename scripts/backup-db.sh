#!/usr/bin/env bash
#
# Sauvegarde logique (pg_dump) de la base RH PEF — filet de sécurité GRATUIT tant que le projet
# Supabase reste sur le plan Free (qui n'offre ni sauvegardes restaurables ni PITR).
#
# Utilisation :
#   DATABASE_URL="postgresql://...:...@db.xxxx.supabase.co:5432/postgres" ./scripts/backup-db.sh
#   (ou : export DATABASE_URL=... puis ./scripts/backup-db.sh)
#
# Le dump est écrit dans ~/Sauvegardes-RH-PEF/ , compressé et horodaté. Les dumps de plus de
# 30 jours sont supprimés automatiquement. Prérequis : pg_dump (brew install libpq).
#
# ⚠️ Un dump contient TOUTES les données de paie (salaires, PII). Conserve-le dans un endroit sûr
#    et chiffré (pas sur un cloud public en clair).

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Erreur : la variable DATABASE_URL n'est pas définie." >&2
  echo "Exemple : DATABASE_URL='postgresql://...' $0" >&2
  exit 1
fi

DEST="${BACKUP_DIR:-$HOME/Sauvegardes-RH-PEF}"
mkdir -p "$DEST"
HORODATAGE="$(date +%Y-%m-%d_%Hh%M)"
FICHIER="$DEST/rh-pef_${HORODATAGE}.sql.gz"

echo "Sauvegarde en cours → $FICHIER"
# --no-owner / --no-privileges : dump réimportable facilement dans une base neuve.
pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=plain | gzip > "$FICHIER"

TAILLE="$(du -h "$FICHIER" | cut -f1)"
echo "✓ Sauvegarde terminée ($TAILLE)."

# Rotation : on garde 30 jours.
find "$DEST" -name 'rh-pef_*.sql.gz' -type f -mtime +30 -delete
echo "✓ Anciennes sauvegardes (>30 j) purgées."
