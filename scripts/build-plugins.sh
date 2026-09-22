#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

compile=0
if [[ ${1:-} == --compile ]]; then
	compile=1
fi

plugin_ids=$("$root/scripts/list-plugin-ids.sh") || exit 1
while IFS= read -r id; do
	entry="plugins/$id/src/main.ts"
	if [[ ! -f "$entry" ]]; then
		echo "plugins/$id is missing src/main.ts" >&2
		exit 1
	fi
	if [[ $compile -eq 1 ]]; then
		bun build --compile --target=bun "$entry" --outfile "dist/$id/plugin"
	else
		bun build --target=bun "$entry" --outfile "dist/$id/plugin.js"
	fi
done <<<"$plugin_ids"
