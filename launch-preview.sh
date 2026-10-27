#!/bin/sh
# Opens the built preview. Notes are saved in this browser's local storage.
set -eu
preview_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
preview_uri=$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).as_uri())' "$preview_dir/dist/xpad-browser/index.html")
exec xdg-open "$preview_uri"
