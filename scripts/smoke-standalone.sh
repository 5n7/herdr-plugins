#!/usr/bin/env bash
set -euo pipefail

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

set +e
env -i ./dist/herdr-even-layout/plugin >"$work_dir/stdout" 2>"$work_dir/stderr"
status=$?
set -e

test "$status" -eq 1
grep -F "HERDR_SOCKET_PATH is not set" "$work_dir/stderr"
