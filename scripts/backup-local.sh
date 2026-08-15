#!/usr/bin/env bash
# Wrapper appelé par launchd : lance la sauvegarde JSON puis ne garde que les 14 plus récentes.
set -euo pipefail
export PATH="/Users/sachatshiongo/.local/node/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
LOG="$HOME/Sauvegardes-RH-PEF/backup.log"
mkdir -p "$HOME/Sauvegardes-RH-PEF"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') ===" >> "$LOG"

# La commande est testée par le `if` : sous `set -e`, un échec ICI ne coupe pas le script (rotation
# + code de sortie propagé quand même), contrairement à l'ancien `... || echo ...` qui neutralisait
# le code de sortie et laissait launchd croire, à tort, que tout s'était bien passé (exit 0).
if npx tsx scripts/backup-json.ts >> "$LOG" 2>&1; then
  code=0
else
  code=$?
  echo "ÉCHEC sauvegarde" >> "$LOG"
fi

# Rotation : conserve les 14 dumps les plus récents — même après un échec, ce sont les précédents
# qui restent le seul filet, on ne les jette pas plus vite pour autant.
ls -1t "$HOME/Sauvegardes-RH-PEF"/rh-pef_*.json 2>/dev/null | tail -n +15 | xargs -I{} rm -f {} || true

exit "$code"
