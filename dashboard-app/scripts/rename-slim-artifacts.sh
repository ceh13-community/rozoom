#!/usr/bin/env bash
# Renames slim-build bundle artifacts (and their .sig siblings) to
# self-descriptive `_slim` names before they are uploaded to the release,
# so a slim asset can never be confused with (or clobber) a full one.
#
# ROZOOM_K8s_Linter_IDE_0.25.0_amd64.deb      -> ..._amd64_slim.deb
# ROZOOM_K8s_Linter_IDE-0.25.0-1.x86_64.rpm   -> ...-1.x86_64_slim.rpm
# ROZOOM_K8s_Linter_IDE_0.25.0_amd64.AppImage -> ..._amd64_slim.AppImage
# ROZOOM_K8s_Linter_IDE_0.25.0_x64_en-US.msi  -> ..._x64_slim_en-US.msi
# ROZOOM_K8s_Linter_IDE_0.25.0_x64-setup.exe  -> ..._x64_slim-setup.exe
# ROZOOM_K8s_Linter_IDE_0.25.0_aarch64.dmg    -> ..._aarch64_slim.dmg
# ROZOOM_K8s_Linter_IDE.app.tar.gz            -> ..._aarch64_slim.app.tar.gz
#
# Usage: rename-slim-artifacts.sh (run from dashboard-app/)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# With --target the bundle dir is nested under the target triple.
BUNDLE_DIR=""
for d in "${ROOT_DIR}"/src-tauri/target/*/release/bundle "${ROOT_DIR}/src-tauri/target/release/bundle"; do
  [[ -d "$d" ]] && BUNDLE_DIR="$d" && break
done
[[ -n "$BUNDLE_DIR" ]] || { echo "no bundle dir found under src-tauri/target" >&2; exit 1; }
echo "bundle dir: $BUNDLE_DIR"

renamed=0

# rename_pair <old_suffix> <new_suffix>: renames every matching artifact and
# its detached .sig (the signature covers file content, not the name, so
# renaming keeps it valid). The suffix goes before the trailing .sig.
rename_pair() {
  local old="$1" new="$2" f base dst
  while IFS= read -r f; do
    base="$(basename "$f")"
    if [[ "$base" == *"$old.sig" ]]; then
      dst="$(dirname "$f")/${base%"$old.sig"}$new.sig"
    else
      dst="$(dirname "$f")/${base%"$old"}$new"
    fi
    [[ "$f" == "$dst" ]] && continue
    mv "$f" "$dst"
    echo "renamed: $base -> $(basename "$dst")"
    renamed=$((renamed + 1))
  done < <(find "$BUNDLE_DIR" -type f \( -name "*$old" -o -name "*$old.sig" \))
}

rename_pair "_amd64.deb"        "_amd64_slim.deb"
rename_pair ".x86_64.rpm"       ".x86_64_slim.rpm"
rename_pair "_amd64.AppImage"   "_amd64_slim.AppImage"
rename_pair "_x64_en-US.msi"    "_x64_slim_en-US.msi"
rename_pair "_x64-setup.exe"    "_x64_slim-setup.exe"
rename_pair "_aarch64.dmg"      "_aarch64_slim.dmg"
# macOS updater archive has no arch/version in its local name.
rename_pair ".app.tar.gz"       "_aarch64_slim.app.tar.gz"

if [[ "$renamed" -eq 0 ]]; then
  echo "no artifacts matched any slim rename pattern in $BUNDLE_DIR" >&2
  exit 1
fi
echo "renamed $renamed files"
