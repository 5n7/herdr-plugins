#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

plugin_ids=$("$root/scripts/list-plugin-ids.sh") || exit 1
if [[ $(uname -s) == Darwin ]]; then
	while IFS= read -r plugin; do
		codesign --force --sign - "dist/$plugin/plugin"
	done <<<"$plugin_ids"
fi
