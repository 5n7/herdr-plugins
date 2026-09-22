#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

shell_files=()
plugin_ids=$("$root/scripts/list-plugin-ids.sh") || exit 1
while IFS= read -r id; do
	shell_files+=("plugins/$id/plugin")
done <<<"$plugin_ids"
while IFS= read -r script; do
	shell_files+=("${script#"$root"/}")
done < <(find "$root/scripts" -maxdepth 1 -name '*.sh' | sort)

case ${1:?} in
format)
	mise exec -- shfmt -w "${shell_files[@]}"
	;;
format:check)
	mise exec -- shfmt -d "${shell_files[@]}"
	;;
lint)
	mise exec -- shellcheck --shell=bash "${shell_files[@]}"
	;;
*)
	echo "usage: scripts/sh-plugins.sh format|format:check|lint" >&2
	exit 2
	;;
esac
