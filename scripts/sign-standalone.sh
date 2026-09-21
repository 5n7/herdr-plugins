#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) == Darwin ]]; then
	codesign --force --sign - dist/herdr-even-layout/plugin
fi
