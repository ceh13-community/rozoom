#!/usr/bin/env bash
# Final single-writer pass over the draft release:
#   1. renames every full-variant asset to a self-descriptive `_full-offline`
#      name (slim assets are already `_slim`-named by their build jobs),
#   2. rewrites the URLs inside latest.json to the renamed assets
#      (signatures cover file content, not names, so they stay valid),
#   2b. removes the bare `linux-x86_64` key from both manifests (Linux
#      packages are not updater-replaceable; assert-no-bare-linux-key.sh),
#   3. verifies both manifests: no bare Linux key, every URL points at an
#      existing asset, every latest-slim.json URL is a `_slim` asset, every
#      latest.json URL is a `_full-offline` asset - the "slim never gets full
#      and vice versa" guarantee, asserted on the release itself.
#
# Runs after all build jobs (needs:) so there are no concurrent writers.
#
# Usage: finalize-release-asset-names.sh <tag>
# Requires: gh (authenticated), jq.
set -euo pipefail

TAG="${1:?release tag required, e.g. app-v0.25.0}"
REPO="${GITHUB_REPOSITORY:-ceh13-community/rozoom}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Draft releases have no tag ref, so look the release up in the list.
RELEASE_ID="$(gh api "repos/${REPO}/releases" --paginate \
  --jq ".[] | select(.tag_name == \"${TAG}\") | .id" | head -n1)"
[[ -n "$RELEASE_ID" ]] || { echo "release with tag $TAG not found" >&2; exit 1; }

gh api "repos/${REPO}/releases/${RELEASE_ID}/assets" --paginate \
  --jq '.[] | "\(.id)\t\(.name)"' > "$tmp/assets.tsv"

# full_offline_name <asset-name>: prints the `_full-offline` name, or nothing
# when the asset must be left alone (manifests, already-marked assets).
full_offline_name() {
  local n="$1" base="" sig=""
  case "$n" in
    latest*.json) return 0 ;;
    *_slim*|*_full-offline*) return 0 ;;
  esac
  if [[ "$n" == *.sig ]]; then base="${n%.sig}"; sig=".sig"; else base="$n"; fi
  local out=""
  case "$base" in
    *_amd64.deb)       out="${base%_amd64.deb}_amd64_full-offline.deb" ;;
    *.x86_64.rpm)      out="${base%.x86_64.rpm}.x86_64_full-offline.rpm" ;;
    *_x64_en-US.msi)   out="${base%_x64_en-US.msi}_x64_full-offline_en-US.msi" ;;
    *_x64-setup.exe)   out="${base%_x64-setup.exe}_x64_full-offline-setup.exe" ;;
    *_aarch64.dmg)     out="${base%_aarch64.dmg}_aarch64_full-offline.dmg" ;;
    *.app.tar.gz)      out="${base%.app.tar.gz}_full-offline.app.tar.gz" ;;
    *) echo "::warning::asset '$n' matches no naming rule; leaving as is" >&2; return 0 ;;
  esac
  printf '%s%s\n' "$out" "$sig"
}

# 1. Rename assets in place via the API; remember old->new for the manifest.
: > "$tmp/renames.tsv"
while IFS=$'\t' read -r asset_id name; do
  new_name="$(full_offline_name "$name")"
  [[ -n "$new_name" && "$new_name" != "$name" ]] || continue
  gh api -X PATCH "repos/${REPO}/releases/assets/${asset_id}" -f name="$new_name" >/dev/null
  printf '%s\t%s\n' "$name" "$new_name" >> "$tmp/renames.tsv"
  echo "renamed asset: $name -> $new_name"
done < "$tmp/assets.tsv"

# 2. Rewrite latest.json URLs to the renamed assets.
if [[ -s "$tmp/renames.tsv" ]]; then
  gh release download "$TAG" --repo "$REPO" --pattern latest.json --dir "$tmp" --clobber
  while IFS=$'\t' read -r old new; do
    # Exact suffix match on the URL basename - no regex, so dots and other
    # metacharacters in asset names cannot mis-match.
    jq --arg old "$old" --arg new "$new" \
      '.platforms |= with_entries(.value.url |=
        (if endswith("/" + $old) then .[:length - ($old | length)] + $new else . end))' \
      "$tmp/latest.json" > "$tmp/latest.patched.json"
    mv "$tmp/latest.patched.json" "$tmp/latest.json"
  done < "$tmp/renames.tsv"
  gh release upload "$TAG" "$tmp/latest.json" --repo "$REPO" --clobber
  echo "latest.json URLs updated to _full-offline asset names"
fi

# 2b. Drop the bare `linux-x86_64` key from both manifests. tauri-action writes
#     it from the Linux .deb; every client up to 0.26.1 acts on it (pkexec on a
#     .deb install, failed write on .rpm, overwritten AppImage - see
#     assert-no-bare-linux-key.sh). Linux installs update by hand; the
#     per-package keys linux-x86_64-deb / -rpm stay for the 0.26.2+ notice.
mkdir -p "$tmp/strip"
for manifest in latest.json latest-slim.json; do
  gh release download "$TAG" --repo "$REPO" --pattern "$manifest" --dir "$tmp/strip" --clobber
  if jq -e '.platforms | has("linux-x86_64")' "$tmp/strip/$manifest" >/dev/null; then
    jq 'del(.platforms["linux-x86_64"])' "$tmp/strip/$manifest" > "$tmp/strip/$manifest.new"
    mv "$tmp/strip/$manifest.new" "$tmp/strip/$manifest"
    gh release upload "$TAG" "$tmp/strip/$manifest" --repo "$REPO" --clobber
    echo "removed the bare linux-x86_64 key from $manifest"
  fi
done

# 3. Cross-verify both manifests against the final asset list.
gh api "repos/${REPO}/releases/${RELEASE_ID}/assets" --paginate \
  --jq '.[].name' > "$tmp/final-assets.txt"

verify_manifest() {
  local manifest="$1" marker="$2" url name
  mkdir -p "$tmp/verify"
  gh release download "$TAG" --repo "$REPO" --pattern "$manifest" --dir "$tmp/verify" --clobber
  # The release fails here if the bare Linux key is back in a manifest (step 2b
  # removed it; a concurrent writer or a changed tauri-action could restore it).
  bash "${SCRIPT_DIR}/assert-no-bare-linux-key.sh" "$tmp/verify/$manifest" || return 1
  while IFS= read -r url; do
    name="${url##*/}"
    if ! grep -qxF "$name" "$tmp/final-assets.txt"; then
      echo "::error::$manifest points at missing asset '$name'" >&2
      return 1
    fi
    if [[ "$name" != *"$marker"* ]]; then
      echo "::error::$manifest points at '$name' which is not a $marker asset" >&2
      return 1
    fi
  done < <(jq -r '.platforms[].url' "$tmp/verify/$manifest")
  echo "OK: every $manifest URL resolves to an existing $marker asset"
}

verify_manifest "latest.json" "_full-offline"
verify_manifest "latest-slim.json" "_slim"
echo "release $TAG finalized"
