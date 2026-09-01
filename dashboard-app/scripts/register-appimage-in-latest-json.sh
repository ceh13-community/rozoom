#!/usr/bin/env bash
# Adds the AppImage built outside tauri-action to the release's latest.json so
# the Tauri updater can serve Linux updates. Usage: register-appimage-in-latest-json.sh <tag>
# Requires: gh (authenticated), jq, a built *.AppImage + *.AppImage.sig under src-tauri.
set -euo pipefail

TAG="${1:?release tag required, e.g. app-v0.23.0}"
REPO="${GITHUB_REPOSITORY:-ceh13-community/rozoom}"
BUNDLE_DIR="src-tauri/target/release/bundle/appimage"

appimage="$(ls "$BUNDLE_DIR"/*.AppImage 2>/dev/null | head -n1 || true)"
if [[ -z "$appimage" ]]; then
  echo "no AppImage in $BUNDLE_DIR, nothing to register" >&2
  exit 1
fi
sig_file="${appimage}.sig"
if [[ ! -f "$sig_file" ]]; then
  echo "missing signature $sig_file (TAURI_SIGNING_PRIVATE_KEY not set?)" >&2
  exit 1
fi

asset_name="$(basename "$appimage")"
url="https://github.com/${REPO}/releases/download/${TAG}/${asset_name}"
signature="$(cat "$sig_file")"

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

jq --arg url "$url" --arg sig "$signature" \
  '.platforms["linux-x86_64"] = {url: $url, signature: $sig}' \
  "$tmp/latest.json" > "$tmp/latest.merged.json"
mv "$tmp/latest.merged.json" "$tmp/latest.json"

gh release upload "$TAG" "$tmp/latest.json" --repo "$REPO" --clobber
echo "registered $asset_name in latest.json for $TAG"
