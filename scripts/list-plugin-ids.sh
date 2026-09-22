#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
ids=$(
	{
		for manifest in "$root"/plugins/*/herdr-plugin.toml; do
			[[ -e "$manifest" ]] || continue
			basename "$(dirname "$manifest")"
		done
	} | sort
)
if [[ -z $ids ]]; then
	echo "no plugins found under plugins/*/herdr-plugin.toml" >&2
	exit 1
fi
printf '%s\n' "$ids"
