#!/usr/bin/env bash
# Release gate (card Y1zBb4Xz, PO decision 05/11/2026): no updater manifest may
# carry the bare `linux-x86_64` key.
#
# tauri-action writes that key from the Linux .deb it built. Every client up to
# 0.26.1 reads only this key on Linux and acts on it: a .deb install runs
# `pkexec dpkg -i` with no explanation, an .rpm install downloads 50-500 MB and
# fails to write, an AppImage is overwritten with the .deb and never starts
# again (measured 05/11/2026, rozoom-engineer/state/measurements/ckfnqZe5).
# Linux installs update by hand. The per-package keys `linux-x86_64-deb` and
# `linux-x86_64-rpm` stay: those clients ignore them, 0.26.2+ reads them to
# announce the release and never downloads on Linux (app-updater.ts).
#
# Usage: assert-no-bare-linux-key.sh <manifest.json> [<manifest.json> ...]
# Exit 0 when no manifest has the key, 1 when any has it. Requires jq.
set -euo pipefail

[[ $# -ge 1 ]] || { echo "usage: $0 <manifest.json> [...]" >&2; exit 2; }

rc=0
for manifest in "$@"; do
  [[ -f "$manifest" ]] || { echo "::error::manifest not found: $manifest" >&2; exit 2; }
  if jq -e '.platforms | has("linux-x86_64")' "$manifest" >/dev/null; then
    url="$(jq -r '.platforms["linux-x86_64"].url // "(no url)"' "$manifest")"
    echo "::error::$(basename "$manifest") carries the bare linux-x86_64 key -> $url. Linux packages are not updater-replaceable; remove the key, keep linux-x86_64-deb and linux-x86_64-rpm." >&2
    rc=1
  else
    echo "OK: $(basename "$manifest") has no bare linux-x86_64 key"
  fi
done
exit $rc
