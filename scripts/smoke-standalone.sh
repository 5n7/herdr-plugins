#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

plugin_ids=$("$root/scripts/list-plugin-ids.sh") || exit 1
while IFS= read -r plugin; do
	set +e
	env -i "./dist/$plugin/plugin" >"$work_dir/stdout" 2>"$work_dir/stderr"
	status=$?
	set -e

	test "$status" -eq 1
	grep -F "HERDR_SOCKET_PATH is not set" "$work_dir/stderr"
done <<<"$plugin_ids"
