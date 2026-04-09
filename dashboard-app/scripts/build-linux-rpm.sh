#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_VERSION="${1:-$(node -p "require('${ROOT_DIR}/src-tauri/tauri.conf.json').version")}"
VERSION="${RAW_VERSION//-/\~}"
RELEASE="${RPM_RELEASE:-1}"
ARCH="${RPM_ARCH:-x86_64}"
PACKAGE_NAME="rozoom-k8s-linter-ide"
PRODUCT_NAME="ROZOOM_K8s_Linter_IDE"
DEB_BUNDLE_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/deb"
RPM_BUNDLE_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/rpm"
TOPDIR="${ROOT_DIR}/src-tauri/target/release/bundle/rpm-rpmbuild"
SPECFILE="${TOPDIR}/SPECS/${PACKAGE_NAME}.spec"
OUTPUT_DIR="${TOPDIR}/RPMS/${ARCH}"

resolve_payload_dir() {
  local candidate

  for candidate in \
    "${DEB_BUNDLE_DIR}/${PRODUCT_NAME}_${RAW_VERSION}_amd64/data" \
    "${DEB_BUNDLE_DIR}/${PRODUCT_NAME}_${VERSION}_amd64/data"; do
    if [[ -d "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done

  return 1
}

PAYLOAD_DIR="$(resolve_payload_dir || true)"

if ! command -v rpmbuild >/dev/null 2>&1; then
  echo "rpmbuild is required to build the RPM fallback artifact." >&2
  exit 1
fi

if [[ -z "${PAYLOAD_DIR}" ]]; then
  echo "Expected DEB payload at ${DEB_BUNDLE_DIR}/${PRODUCT_NAME}_${RAW_VERSION}_amd64/data." >&2
  echo "Run 'pnpm exec tauri build --bundles deb' first." >&2
  exit 1
fi

rm -rf "${TOPDIR}"
mkdir -p "${TOPDIR}/BUILD" "${TOPDIR}/BUILDROOT" "${TOPDIR}/RPMS" "${TOPDIR}/SOURCES" "${TOPDIR}/SPECS" "${TOPDIR}/SRPMS"
mkdir -p "${RPM_BUNDLE_DIR}"

cat >"${SPECFILE}" <<EOF
Name: ${PACKAGE_NAME}
Version: ${VERSION}
Release: ${RELEASE}%{?dist}
Summary: ${PRODUCT_NAME}
License: MIT
BuildArch: ${ARCH}
AutoReq: yes
AutoProv: no

%description
Desktop Kubernetes operator tooling built with Tauri.

%prep

%build

%install
mkdir -p "%{buildroot}"
cp -a "${PAYLOAD_DIR}/." "%{buildroot}/"

%files
%defattr(-,root,root,-)
/usr/bin/rozoom-az-cli
/usr/bin/rozoom-doctl
/usr/bin/rozoom-hcloud
/usr/bin/rozoom-helm
/usr/bin/rozoom-k8s-linter-ide
/usr/bin/rozoom-kubeconform
/usr/bin/rozoom-kubectl
/usr/bin/rozoom-kustomize
/usr/bin/rozoom-oc
/usr/bin/rozoom-pluto
/usr/bin/rozoom-stern
/usr/bin/rozoom-velero
/usr/bin/rozoom-yq
/usr/lib/ROZOOM_K8s_Linter_IDE
/usr/share/applications/ROZOOM_K8s_Linter_IDE.desktop
/usr/share/icons/hicolor/32x32/apps/rozoom-k8s-linter-ide.png
/usr/share/icons/hicolor/128x128/apps/rozoom-k8s-linter-ide.png
/usr/share/icons/hicolor/256x256@2/apps/rozoom-k8s-linter-ide.png
EOF

rpmbuild -bb --define "_topdir ${TOPDIR}" "${SPECFILE}"

RPM_ARTIFACT="$(find "${OUTPUT_DIR}" -maxdepth 1 -type f -name '*.rpm' | head -n 1)"
if [[ -z "${RPM_ARTIFACT}" ]]; then
  echo "rpmbuild completed without producing an RPM artifact." >&2
  exit 1
fi

NORMALIZED_RPM_ARTIFACT="${RPM_BUNDLE_DIR}/${PRODUCT_NAME}_${VERSION}_${ARCH}.rpm"
cp -f "${RPM_ARTIFACT}" "${NORMALIZED_RPM_ARTIFACT}"
echo "RPM built at ${NORMALIZED_RPM_ARTIFACT}"
