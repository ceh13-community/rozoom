#!/usr/bin/env bash
# Release gate for the Linux full bundle: the optional resource dirs that
# download-binaries.js may replace with an empty stub when their install fails
# or stalls (aws-dist, az-dist) must really be inside the installer, and the
# bundled THIRD-PARTY-LICENSES.md must list them. Release 0.26.0 (2026-11-04,
# runs 41787001371 and 41790641141) would otherwise have shipped the Linux
# full-offline .deb without the AWS CLI while the build stayed green.
#
# Usage: assert-bundle-resources.sh <path.deb> [aws] [az]
#   checks default to "aws az".
set -euo pipefail

DEB="${1:?path to .deb required}"
shift
CHECKS=("$@")
[[ ${#CHECKS[@]} -gt 0 ]] || CHECKS=(aws az)
[[ -f "$DEB" ]] || { echo "deb not found: $DEB" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$HERE/../static/binaries/install-manifest.json"
[[ -f "$MANIFEST" ]] || { echo "binaries manifest not found: $MANIFEST" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
dpkg-deb -x "$DEB" "$tmp/root"
licenses="$(find "$tmp/root" -type f -name THIRD-PARTY-LICENSES.md | head -n 1 || true)"
[[ -n "$licenses" ]] || { echo "::error::THIRD-PARTY-LICENSES.md is not inside $(basename "$DEB")" >&2; exit 1; }

fail() { echo "::error::$(basename "$DEB"): $*" >&2; exit 1; }

for check in "${CHECKS[@]}"; do
  case "$check" in
    aws) dir=aws-dist; binary=aws-dist/aws; label='| AWS CLI v2 |' ;;
    az)  dir=az-dist;  binary=az-dist/bin/az; label='| Azure CLI |' ;;
    *) echo "unknown check: $check" >&2; exit 2 ;;
  esac
  root="$(find "$tmp/root" -type d -path "*/binaries/$dir" | head -n 1 || true)"
  [[ -n "$root" ]] || fail "binaries/$dir is not in the bundle"
  [[ ! -e "$root/.stub" ]] || fail "binaries/$dir is an empty stub (install failed or timed out during the build)"
  [[ -f "$root/${binary#"$dir/"}" ]] || fail "binaries/$binary is missing (interrupted extract or copy)"
  files="$(find "$root" -type f | wc -l)"
  [[ "$files" -ge 500 ]] || fail "binaries/$dir holds only $files files, not a complete install"
  version="$(node -p "const t=require(process.argv[1]).tools[process.argv[2]]; t ? t.version : ''" "$MANIFEST" "$check")"
  [[ -n "$version" ]] || fail "install-manifest.json has no entry for $check, so the licenses were generated without it"
  grep -qF "$label" "$licenses" || fail "bundled THIRD-PARTY-LICENSES.md has no row $label although $dir is bundled"
  echo "ok: $check $version bundled ($files files) and listed in THIRD-PARTY-LICENSES.md"
done

echo "OK: bundled resource dirs verified in built artifact"
