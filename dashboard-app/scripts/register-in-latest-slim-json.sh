#!/usr/bin/env bash
# Owns one platform entry of the release's latest-slim.json.
#
# Slim builds use a separate updater manifest (latest-slim.json) so a slim
# install can never be offered a full artifact and vice versa; the legacy
# endpoint (latest.json) keeps serving full artifacts to 0.23.x/0.24.x
# installs untouched. tauri-action only knows how to write latest.json, so
# the slim manifest is assembled here, one platform entry per slim job.
#
# The three slim platform jobs may write concurrently; a lost update is
# detected by re-downloading after upload and retried.
#
# Usage: register-in-latest-slim-json.sh <tag> <platform-key> <artifact-path>
#   e.g. register-in-latest-slim-json.sh app-v0.25.0 linux-x86_64 \
#          src-tauri/target/release/bundle/appimage/ROZOOM_..._slim.AppImage
# Requires: gh (authenticated), jq, <artifact-path>.sig next to the artifact.
set -euo pipefail

TAG="${1:?release tag required, e.g. app-v0.25.0}"
PLATFORM_KEY="${2:?platform key required, e.g. linux-x86_64}"
ARTIFACT="${3:?artifact path required}"
REPO="${GITHUB_REPOSITORY:-ceh13-community/rozoom}"
MANIFEST="latest-slim.json"

[[ -f "$ARTIFACT" ]] || { echo "artifact not found: $ARTIFACT" >&2; exit 1; }
SIG_FILE="${ARTIFACT}.sig"
[[ -f "$SIG_FILE" ]] || { echo "missing signature $SIG_FILE (TAURI_SIGNING_PRIVATE_KEY not set?)" >&2; exit 1; }

VERSION="${TAG#app-v}"
ASSET_NAME="$(basename "$ARTIFACT")"
case "$ASSET_NAME" in
  *_slim*) ;;
  *) echo "refusing to register non-slim asset '$ASSET_NAME' in $MANIFEST" >&2; exit 1 ;;
esac
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET_NAME}"
SIGNATURE="$(cat "$SIG_FILE")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for attempt in 1 2 3 4 5; do
  rm -f "$tmp/$MANIFEST"
  if ! gh release download "$TAG" --repo "$REPO" --pattern "$MANIFEST" --dir "$tmp" --clobber 2>/dev/null; then
    jq -n --arg v "$VERSION" --arg notes \
      "ROZOOM v${VERSION} (slim tool-pack: kubectl + helm bundled). Full notes: https://github.com/${REPO}/releases/tag/${TAG}" \
      --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{version: $v, notes: $notes, pub_date: $date, platforms: {}}' > "$tmp/$MANIFEST"
  fi

  jq --arg key "$PLATFORM_KEY" --arg url "$URL" --arg sig "$SIGNATURE" \
    '.platforms[$key] = {url: $url, signature: $sig}' \
    "$tmp/$MANIFEST" > "$tmp/merged.json"
  mv "$tmp/merged.json" "$tmp/$MANIFEST"

  gh release upload "$TAG" "$tmp/$MANIFEST" --repo "$REPO" --clobber

  # Concurrent platform jobs can clobber each other; confirm our entry
  # survived, otherwise merge and upload again on a fresh download.
  sleep 5
  mkdir -p "$tmp/check"
  rm -f "$tmp/check/$MANIFEST"
  if gh release download "$TAG" --repo "$REPO" --pattern "$MANIFEST" --dir "$tmp/check" --clobber 2>/dev/null \
    && [[ "$(jq -r --arg key "$PLATFORM_KEY" '.platforms[$key].url // empty' "$tmp/check/$MANIFEST")" == "$URL" ]]; then
    echo "registered $ASSET_NAME as $PLATFORM_KEY in $MANIFEST for $TAG"
    exit 0
  fi
  echo "entry for $PLATFORM_KEY lost to a concurrent writer (attempt $attempt); retrying" >&2
  sleep $((attempt * 5))
done

echo "failed to register $PLATFORM_KEY in $MANIFEST after 5 attempts" >&2
exit 1
