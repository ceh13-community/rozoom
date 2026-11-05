#!/usr/bin/env bash
# Keep PKGBUILD and .SRCINFO in step with a published GitHub release.
#
#   ./update-pkgbuild.sh            sync to the latest published release
#   ./update-pkgbuild.sh 0.26.0     sync to release app-v0.26.0
#   ./update-pkgbuild.sh --check    change nothing; exit 1 and say why when
#                                   PKGBUILD or .SRCINFO lags behind the
#                                   latest release
#
# Exit codes: 0 in step or updated, 1 out of step (--check only), 2 error. On
# an error neither file is changed.
# Needs curl and jq. The .deb checksum is the sha256 digest GitHub stores for
# every release asset, so nothing big is downloaded. GITHUB_TOKEN or GH_TOKEN,
# when set, lifts the anonymous API rate limit.
set -euo pipefail

repo="ceh13-community/rozoom"
api="https://api.github.com/repos/${repo}"
cd "$(dirname "${BASH_SOURCE[0]}")"

die() { echo "update-pkgbuild: $*" >&2; exit 2; }

check=0
version=""
for arg in "$@"; do
  case "$arg" in
    --check) check=1 ;;
    -h | --help) sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "unknown option ${arg}" ;;
    *) version="$arg" ;;
  esac
done

auth=()
token="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
[[ -n "$token" ]] && auth=(-H "Authorization: Bearer ${token}")
gh_api() { curl -fsSL -H 'Accept: application/vnd.github+json' "${auth[@]}" "$1"; }

if [[ -z "$version" ]]; then
  version="$(gh_api "${api}/releases/latest" | jq -r '.tag_name // empty')" \
    || die "cannot read the latest release from GitHub"
  version="${version#app-v}"
fi
# The version goes into sed expressions and URLs below: accept plain X.Y.Z only.
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "unexpected version '${version}' (want X.Y.Z)"
tag="app-v${version}"
deb="ROZOOM_K8s_Linter_IDE_${version}_amd64_slim.deb"

deb_sha="$(gh_api "${api}/releases/tags/${tag}" \
  | jq -r --arg name "$deb" '.assets[] | select(.name == $name) | .digest // empty')" \
  || die "cannot read release ${tag} from GitHub"
deb_sha="${deb_sha#sha256:}"
[[ "$deb_sha" =~ ^[0-9a-f]{64}$ ]] || die "release ${tag} has no sha256 digest for ${deb}"
license_sha="$(curl -fsSL "https://raw.githubusercontent.com/${repo}/${tag}/LICENSE" | sha256sum | cut -d' ' -f1)" \
  || die "cannot fetch LICENSE at ${tag}"

# What each file records, as "pkgver pkgrel deb-sha license-sha".
pkgbuild_state() {
  echo "$(sed -n 's/^pkgver=//p' "$1")" "$(sed -n 's/^pkgrel=//p' "$1")" \
    "$(sed -n '/^sha256sums=(/,/)/p' "$1" | grep -o '[0-9a-f]\{64\}' | paste -sd' ' -)"
}
srcinfo_state() {
  echo "$(sed -n 's/^\tpkgver = //p' "$1")" "$(sed -n 's/^\tpkgrel = //p' "$1")" \
    "$(sed -n 's/^\tsha256sums = //p' "$1" | paste -sd' ' -)"
}
well_formed() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\ [0-9]+\ [0-9a-f]{64}\ [0-9a-f]{64}$ ]]; }

have="$(pkgbuild_state PKGBUILD)"
have_src="$(srcinfo_state .SRCINFO)"
well_formed "$have" || die "PKGBUILD needs pkgver, pkgrel and exactly two sha256sums (.deb, LICENSE); found '${have}'"
well_formed "$have_src" \
  || die ".SRCINFO is malformed ('${have_src}'); regenerate it with makepkg --printsrcinfo > .SRCINFO"
read -r have_version have_rel have_deb have_license <<<"$have"
read -r src_version _ src_deb src_license <<<"$have_src"

# Same release and same files keep pkgrel. A re-uploaded asset under the same
# version is a packaging-only change and bumps it. A new version starts at 1.
if [[ "$have_version $have_deb $have_license" == "$version $deb_sha $license_sha" ]]; then
  rel="$have_rel"
elif [[ "$have_version" == "$version" ]]; then
  rel=$((have_rel + 1))
else
  rel=1
fi
want="${version} ${rel} ${deb_sha} ${license_sha}"

if [[ "$have" == "$want" && "$have_src" == "$want" ]]; then
  echo "PKGBUILD and .SRCINFO are in step with ${tag}"
  exit 0
fi
if (( check )); then
  {
    echo "out of step with ${tag} (pkgver pkgrel deb-sha license-sha):"
    echo "  release   ${want}"
    echo "  PKGBUILD  ${have}"
    echo "  .SRCINFO  ${have_src}"
  } >&2
  exit 1
fi

# Rewrite copies, replacing each old value by its new one wherever it stands
# (.SRCINFO repeats the version inside the source names), and swap the copies
# in only when both read back as wanted.
trap 'rm -f PKGBUILD.new .SRCINFO.new' EXIT
sed -e "s/^pkgver=.*/pkgver=${version}/" -e "s/^pkgrel=.*/pkgrel=${rel}/" \
  -e "s/${have_deb}/${deb_sha}/g" -e "s/${have_license}/${license_sha}/g" \
  PKGBUILD > PKGBUILD.new
sed -e "s/${src_version//./\\.}/${version}/g" -e "s/^\tpkgrel = .*/\tpkgrel = ${rel}/" \
  -e "s/${src_deb}/${deb_sha}/g" -e "s/${src_license}/${license_sha}/g" \
  .SRCINFO > .SRCINFO.new
[[ "$(pkgbuild_state PKGBUILD.new)" == "$want" ]] || die "could not rewrite PKGBUILD; nothing was changed"
[[ "$(srcinfo_state .SRCINFO.new)" == "$want" ]] \
  || die "could not rewrite .SRCINFO; nothing was changed. Regenerate it with makepkg --printsrcinfo > .SRCINFO"
mv PKGBUILD.new PKGBUILD
mv .SRCINFO.new .SRCINFO
echo "PKGBUILD and .SRCINFO updated to ${tag} (pkgrel ${rel})"
