#!/usr/bin/env bash
# Release gate: the installer must carry THIRD-PARTY-LICENSES.md, and that copy
# must name the tool versions that were actually bundled. The file is a Tauri
# resource (bundle.resources in tauri.conf.json and tauri.slim.conf.json); if
# the resource map is dropped or the overlay stops carrying it, the release
# silently ships without the license texts of the sidecar tools. Assert on the
# built artifact, not on the config, same policy as the slim updater gate.
#
# Usage: assert-bundle-licenses.sh <path.deb> [<tool>...]
#   tools default to "kubectl helm": present in both the full and slim bundle.
set -euo pipefail

DEB="${1:?path to .deb required}"
shift
TOOLS=("$@")
[[ ${#TOOLS[@]} -gt 0 ]] || TOOLS=(kubectl helm)
[[ -f "$DEB" ]] || { echo "deb not found: $DEB" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$HERE/../static/binaries/install-manifest.json"
[[ -f "$MANIFEST" ]] || { echo "binaries manifest not found: $MANIFEST" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

dpkg-deb -x "$DEB" "$tmp/root"
file="$(find "$tmp/root" -type f -name THIRD-PARTY-LICENSES.md | head -n 1 || true)"
if [[ -z "$file" ]]; then
  echo "::error::THIRD-PARTY-LICENSES.md is not inside $(basename "$DEB"); bundle.resources lost it" >&2
  exit 1
fi
echo "found ${file#"$tmp/root"} in $(basename "$DEB")"

for tool in "${TOOLS[@]}"; do
  version="$(node -p "require(process.argv[1]).tools[process.argv[2]].version" "$MANIFEST" "$tool")"
  # The tools table lists "| <name> | <version> |"; a heading repeats the version too.
  if ! grep -qF "| $version |" "$file"; then
    echo "::error::$(basename "$DEB") ships $tool $version but its THIRD-PARTY-LICENSES.md does not list that version" >&2
    exit 1
  fi
  echo "ok: $tool $version listed"
done

echo "OK: third-party licenses verified in built artifact"
