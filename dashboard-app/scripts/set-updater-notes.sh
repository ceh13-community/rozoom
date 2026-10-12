#!/usr/bin/env bash
# Rewrites the `notes` field of a release's updater manifests (latest.json and
# latest-slim.json) to the given text.
#
# tauri-action copies the whole GitHub release body (artifact table and all)
# into latest.json notes, and the slim manifest is bootstrapped with a
# placeholder; both end up verbatim in the in-app updater dialog. This script
# runs in finalize-release-assets and replaces both with the changelog text,
# then re-downloads each manifest to verify the upload actually took.
#
# Usage: set-updater-notes.sh <tag> <notes-file>
#   e.g. set-updater-notes.sh app-v0.25.3 /tmp/notes.md
# Requires: gh (authenticated), jq.
set -euo pipefail

TAG="${1:?release tag required, e.g. app-v0.25.3}"
NOTES_FILE="${2:?notes file required}"
REPO="${GITHUB_REPOSITORY:-ceh13-community/rozoom}"

[[ -s "$NOTES_FILE" ]] || { echo "notes file missing or empty: $NOTES_FILE" >&2; exit 1; }

NOTES="$(cat "$NOTES_FILE")

Full notes: https://github.com/${REPO}/releases/tag/${TAG}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

failed=0
for manifest in latest.json latest-slim.json; do
  rm -f "$tmp/$manifest"
  if ! gh release download "$TAG" --repo "$REPO" --pattern "$manifest" --dir "$tmp" --clobber 2>/dev/null; then
    echo "$manifest not found on $TAG; skipping" >&2
    continue
  fi

  jq --arg notes "$NOTES" '.notes = $notes' "$tmp/$manifest" > "$tmp/updated.json"
  mv "$tmp/updated.json" "$tmp/$manifest"
  gh release upload "$TAG" "$tmp/$manifest" --repo "$REPO" --clobber

  # Verify by re-downloading from the release, not by trusting the upload.
  mkdir -p "$tmp/check"
  rm -f "$tmp/check/$manifest"
  gh release download "$TAG" --repo "$REPO" --pattern "$manifest" --dir "$tmp/check" --clobber
  if [[ "$(jq -r '.notes' "$tmp/check/$manifest")" == "$NOTES" ]]; then
    echo "updated notes in $manifest for $TAG"
  else
    echo "notes verification failed for $manifest on $TAG" >&2
    failed=1
  fi
done

exit "$failed"
