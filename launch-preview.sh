#!/bin/sh
# Opens the built preview. Notes are saved in this browser's local storage.
set -eu
preview_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
preview_uri=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).as_uri())' "$preview_dir/dist/xpad-browser/index.html")
if [ ! -f "$preview_dir/dist/xpad-browser/index.html" ]; then
  echo 'Build the preview first: npm run build:ui && python3 scripts/package-browser.py' >&2
  exit 1
fi
if command -v xdg-open >/dev/null 2>&1; then
  exec xdg-open "$preview_uri"
elif command -v open >/dev/null 2>&1; then
  exec open "$preview_uri"
fi
echo "Open this address in your browser: $preview_uri"
