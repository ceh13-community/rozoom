#!/usr/bin/env bash
# Prints the CHANGELOG.md section for one version, for use as updater release
# notes and the GitHub release body.
#
# The first paragraph of the section is what a user reads in the in-app
# updater dialog, so it must state the user-facing change in plain language
# (0.25.3 shipped "is available as a draft build." there). A missing section
# fails the release loudly: the bump PR must carry the changelog entry.
#
# Usage: extract-release-notes.sh <version> [changelog-path]
#   e.g. extract-release-notes.sh 0.25.3 ../CHANGELOG.md
set -euo pipefail

VERSION="${1:?version required, e.g. 0.25.3}"
CHANGELOG="${2:-CHANGELOG.md}"

[[ -f "$CHANGELOG" ]] || { echo "changelog not found: $CHANGELOG" >&2; exit 1; }

notes="$(awk -v ver="$VERSION" '
  /^## \[/ {
    if (inside) exit
    inside = ($2 == "[" ver "]")
    next
  }
  inside { print }
' "$CHANGELOG")"

# Trim leading/trailing blank lines.
notes="$(printf '%s' "$notes" | sed -e '/./,$!d' | sed -e ':a' -e '/^\n*$/{$d;N;ba' -e '}')"

if [[ -z "$notes" ]]; then
  echo "no changelog entry for version $VERSION in $CHANGELOG; add it to the bump PR" >&2
  exit 1
fi

printf '%s\n' "$notes"
