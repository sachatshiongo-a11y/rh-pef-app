#!/usr/bin/env bash
# Wrapper appelé par launchd : lance la sauvegarde JSON puis ne garde que les 14 plus récentes.
set -euo pipefail
export PATH="/Users/sachatshiongo/.local/node/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
LOG="$HOME/Sauvegardes-RH-PEF/backup.log"
mkdir -p "$HOME/Sauvegardes-RH-PEF"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"
npx tsx scripts/backup-json.ts >> "$LOG" 2>&1 || echo "ÉCHEC sauvegarde" >> "$LOG"
# Rotation : conserve les 14 dumps les plus récents.
ls -1t "$HOME/Sauvegardes-RH-PEF"/rh-pef_*.json 2>/dev/null | tail -n +15 | xargs -I{} rm -f {} || true
