#!/usr/bin/env bash
# Keep PKGBUILD and .SRCINFO in step with a published GitHub release.
#
#   ./update-pkgbuild.sh            sync to the latest published release
#   ./update-pkgbuild.sh 0.26.0     sync to release app-v0.26.0
#   ./update-pkgbuild.sh --check    change nothing; exit 1 and say why when
#                                   PKGBUILD lags behind the latest release
#
# Needs curl and jq. The .deb checksum is the sha256 digest GitHub stores for
# every release asset, so nothing big is downloaded. GITHUB_TOKEN or GH_TOKEN,
# when set, lifts the anonymous API rate limit.
set -euo pipefail

repo="ceh13-community/rozoom"
api="https://api.github.com/repos/${repo}"
cd "$(dirname "${BASH_SOURCE[0]}")"

check=0
version=""
for arg in "$@"; do
  case "$arg" in
    --check) check=1 ;;
    -h | --help) sed -n '2,11p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "update-pkgbuild: unknown option ${arg}" >&2; exit 2 ;;
    *) version="$arg" ;;
  esac
done

auth=()
token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
[[ -n "$token" ]] && auth=(-H "Authorization: Bearer ${token}")
gh_api() { curl -fsSL -H 'Accept: application/vnd.github+json' "${auth[@]}" "$1"; }

if [[ -z "$version" ]]; then
  version="$(gh_api "${api}/releases/latest" | jq -r '.tag_name')"
  version="${version#app-v}"
fi
tag="app-v${version}"
deb="ROZOOM_K8s_Linter_IDE_${version}_amd64_slim.deb"

deb_sha="$(gh_api "${api}/releases/tags/${tag}" \
  | jq -r --arg name "$deb" '.assets[] | select(.name == $name) | .digest // empty')"
deb_sha="${deb_sha#sha256:}"
if [[ ! "$deb_sha" =~ ^[0-9a-f]{64}$ ]]; then
  echo "update-pkgbuild: release ${tag} has no sha256 digest for ${deb}" >&2
  exit 2
fi
license_sha="$(curl -fsSL "https://raw.githubusercontent.com/${repo}/${tag}/LICENSE" | sha256sum | cut -d' ' -f1)"

have_version="$(sed -n 's/^pkgver=//p' PKGBUILD)"
have_rel="$(sed -n 's/^pkgrel=//p' PKGBUILD)"
have_shas="$(sed -n '/^sha256sums=(/,/)/p' PKGBUILD | grep -o '[0-9a-f]\{64\}' | paste -sd' ')"
want_shas="${deb_sha} ${license_sha}"

if [[ "$have_version" == "$version" && "$have_shas" == "$want_shas" ]]; then
  echo "PKGBUILD is in step with ${tag}"
  exit 0
fi
if (( check )); then
  echo "PKGBUILD has ${have_version} (${have_shas}); release ${tag} needs ${want_shas}" >&2
  exit 1
fi

# Same version with a re-uploaded asset is a packaging-only change: bump pkgrel.
if [[ "$have_version" == "$version" ]]; then rel=$((have_rel + 1)); else rel=1; fi

sed -i \
  -e "s/^pkgver=.*/pkgver=${version}/" \
  -e "s/^pkgrel=.*/pkgrel=${rel}/" \
  -e "/^sha256sums=(/s/[0-9a-f]\{64\}/${deb_sha}/" \
  -e "/^sha256sums=(/{n;s/[0-9a-f]\{64\}/${license_sha}/}" \
  PKGBUILD

# .SRCINFO carries the same facts: the version (also inside the source names),
# pkgrel and the two checksums in the same order as PKGBUILD.
sed -i \
  -e "s/${have_version//./\\.}/${version}/g" \
  -e "s/^\tpkgrel = .*/\tpkgrel = ${rel}/" \
  .SRCINFO
awk -v deb="$deb_sha" -v lic="$license_sha" '
  /^\tsha256sums = / { n++; $0 = "\tsha256sums = " (n == 1 ? deb : lic) }
  { print }
' .SRCINFO > .SRCINFO.new && mv .SRCINFO.new .SRCINFO

if ! grep -q "^	pkgver = ${version}$" .SRCINFO || ! grep -q "$deb_sha" .SRCINFO || ! grep -q "$license_sha" .SRCINFO; then
  echo "update-pkgbuild: .SRCINFO did not pick up the new values" >&2
  exit 2
fi
echo "PKGBUILD and .SRCINFO updated to ${tag} (pkgrel ${rel})"
