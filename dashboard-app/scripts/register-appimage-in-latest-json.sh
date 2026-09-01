#!/usr/bin/env bash
# Owns the linux-x86_64 entry of the release's latest.json.
#
# tauri-action publishes latest.json from the deb/rpm build and points
# linux-x86_64 at the .deb. The in-app updater (tauri-plugin-updater 2.9)
# can only replace an AppImage, so that entry would make every Linux install
# download a package it cannot apply and sit on "Update failed" forever.
# This script replaces it with the AppImage built outside tauri-action, and
# when there is no AppImage it removes the entry and fails: no AppImage,
# no linux-x86_64 record. The bundle-specific keys (-deb, -rpm) are left
# alone; the updater ignores them.
#
# Usage: register-appimage-in-latest-json.sh <tag>
# Requires: gh (authenticated), jq, a built *.AppImage + *.AppImage.sig under src-tauri.
set -euo pipefail

TAG="${1:?release tag required, e.g. app-v0.23.0}"
REPO="${GITHUB_REPOSITORY:-ceh13-community/rozoom}"
BUNDLE_DIR="src-tauri/target/release/bundle/appimage"
PLATFORM_KEY="linux-x86_64"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# tauri-action publishes latest.json from the platform jobs; the Linux job may
# run before or after them, so retry briefly for the asset to exist.
for attempt in 1 2 3 4 5 6; do
  if gh release download "$TAG" --repo "$REPO" --pattern latest.json --dir "$tmp" --clobber 2>/dev/null; then
    break
  fi
  echo "latest.json not on release yet (attempt $attempt), waiting" >&2
  sleep 20
done
if [[ ! -f "$tmp/latest.json" ]]; then
  echo "latest.json never appeared on $TAG" >&2
  exit 1
fi

publish_latest_json() {
  gh release upload "$TAG" "$tmp/latest.json" --repo "$REPO" --clobber
}

# Never leave linux-x86_64 pointing at a deb/rpm, even on the failure path.
strip_platform_entry() {
  jq --arg key "$PLATFORM_KEY" 'del(.platforms[$key])' "$tmp/latest.json" > "$tmp/latest.stripped.json"
  mv "$tmp/latest.stripped.json" "$tmp/latest.json"
  publish_latest_json
}

appimage="$(ls "$BUNDLE_DIR"/*.AppImage 2>/dev/null | head -n1 || true)"
if [[ -z "$appimage" ]]; then
  echo "no AppImage in $BUNDLE_DIR; removing $PLATFORM_KEY from latest.json and failing" >&2
  strip_platform_entry
  exit 1
fi
sig_file="${appimage}.sig"
if [[ ! -f "$sig_file" ]]; then
  echo "missing signature $sig_file (TAURI_SIGNING_PRIVATE_KEY not set?); removing $PLATFORM_KEY and failing" >&2
  strip_platform_entry
  exit 1
fi

asset_name="$(basename "$appimage")"
url="https://github.com/${REPO}/releases/download/${TAG}/${asset_name}"
signature="$(cat "$sig_file")"

jq --arg key "$PLATFORM_KEY" --arg url "$url" --arg sig "$signature" \
  '.platforms[$key] = {url: $url, signature: $sig}' \
  "$tmp/latest.json" > "$tmp/latest.merged.json"
mv "$tmp/latest.merged.json" "$tmp/latest.json"

publish_latest_json
echo "registered $asset_name as $PLATFORM_KEY in latest.json for $TAG"
