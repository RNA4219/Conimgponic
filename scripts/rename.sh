
#!/usr/bin/env bash
set -euo pipefail
DIR="${1:-.}"
node "$(dirname "$0")/rename.mjs" "$DIR"
echo "Rename complete. Please re-run PWA and re-install for new name to show."
