#!/usr/bin/env bash
# Release gate on an updater manifest (latest.json, latest-slim.json), card Y1zBb4Xz.
#
# A manifest is accepted only when, in this order:
#   1. it is a JSON object (a jq parse error, an empty file or a bare value fails:
#      a slim job whose download of latest-slim.json failed must not leave an
#      empty or one-entry manifest behind),
#   2. `.platforms` is an object,
#   3. `.platforms` has linux-x86_64-deb, linux-x86_64-rpm, darwin-aarch64 and
#      windows-x86_64 (an entry lost to a failed job or a clobbering writer fails here),
#   4. every platform entry has a string `url` and `signature`,
#   5. the bare `linux-x86_64` key is absent. tauri-action writes it from the
#      Linux .deb; every client up to 0.26.1 reads only this key on Linux and
#      acts on it: a .deb install runs `pkexec dpkg -i` with no explanation, an
#      .rpm install downloads 50-500 MB and fails to write, an AppImage is
#      overwritten with the .deb and never starts again (measured 05/11/2026,
#      rozoom-engineer/state/measurements/ckfnqZe5). Linux installs update by
#      hand; the per-package keys stay: those clients ignore them, 0.26.2+ reads
#      them to announce the release and never downloads on Linux (app-updater.ts).
#
# Usage: assert-updater-manifest.sh <manifest.json> [<manifest.json> ...]
# Exit 0 when every manifest passes, 1 when any fails, 2 on usage. Requires jq.
set -uo pipefail

[[ $# -ge 1 ]] || { echo "usage: $0 <manifest.json> [...]" >&2; exit 2; }

REQUIRED_KEYS=(linux-x86_64-deb linux-x86_64-rpm darwin-aarch64 windows-x86_64)
errfile="$(mktemp)"
trap 'rm -f "$errfile"' EXIT
rc=0
ok=1

fail() { echo "::error::$1" >&2; rc=1; ok=0; }

for manifest in "$@"; do
  name="$(basename "$manifest")"
  ok=1
  [[ -f "$manifest" ]] || { echo "::error::manifest not found: $manifest" >&2; exit 2; }

  if ! jq -e 'type == "object"' "$manifest" >/dev/null 2>"$errfile"; then
    fail "$name is not a JSON object ($(tr '\n' ' ' <"$errfile" | cut -c1-160)size $(wc -c <"$manifest") bytes)"
    continue
  fi
  if ! jq -e '.platforms | type == "object"' "$manifest" >/dev/null; then
    fail "$name: .platforms is missing or not an object"
    continue
  fi
  missing=()
  for key in "${REQUIRED_KEYS[@]}"; do
    jq -e --arg k "$key" '.platforms | has($k)' "$manifest" >/dev/null || missing+=("$key")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "$name misses platform keys: ${missing[*]} (has: $(jq -r '.platforms | keys | join(" ")' "$manifest"))"
  fi
  if ! jq -e '.platforms | all(.[]; (.url | type == "string") and (.signature | type == "string"))' "$manifest" >/dev/null; then
    fail "$name: a platform entry lacks a string url or signature"
  fi
  if jq -e '.platforms | has("linux-x86_64")' "$manifest" >/dev/null; then
    url="$(jq -r '.platforms["linux-x86_64"].url // "(no url)"' "$manifest")"
    fail "$name carries the bare linux-x86_64 key -> $url. Linux packages are not updater-replaceable; remove the key, keep linux-x86_64-deb and linux-x86_64-rpm."
  fi
  [[ $ok -eq 1 ]] && echo "OK: $name is a valid manifest with ${REQUIRED_KEYS[*]} and no bare linux-x86_64 key"
done
exit $rc
