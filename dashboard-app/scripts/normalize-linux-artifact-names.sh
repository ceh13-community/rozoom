#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(node -p "require('${ROOT_DIR}/src-tauri/tauri.conf.json').version")}"
BUNDLE_DIR="${ROOT_DIR}/src-tauri/target/release/bundle"
DEB_DIR="${BUNDLE_DIR}/deb"
RPM_DIR="${BUNDLE_DIR}/rpm"
PRODUCT_NAME="ROZOOM_K8s_Linter_IDE"

rename_if_present() {
  local src="$1"
  local dst="$2"

  if [[ ! -e "${src}" || "${src}" == "${dst}" ]]; then
    return 0
  fi

  rm -rf "${dst}"
  mv "${src}" "${dst}"
  echo "Renamed $(basename "${src}") -> $(basename "${dst}")"
}

# Legacy DEB name (spaces) -> normalized (kept for backward compat)
rename_if_present \
  "${DEB_DIR}/ROZOOM - K8s Linter IDE_${VERSION}_amd64.deb" \
  "${DEB_DIR}/${PRODUCT_NAME}_${VERSION}_amd64.deb"

rename_if_present \
  "${DEB_DIR}/ROZOOM - K8s Linter IDE_${VERSION}_amd64" \
  "${DEB_DIR}/${PRODUCT_NAME}_${VERSION}_amd64"

# RPM: rpmbuild uses package name (lowercase-dashed) -> normalized
rename_if_present \
  "${RPM_DIR}/rozoom-k8s-linter-ide-${VERSION}-1.x86_64.rpm" \
  "${RPM_DIR}/${PRODUCT_NAME}_${VERSION}_x86_64.rpm"
