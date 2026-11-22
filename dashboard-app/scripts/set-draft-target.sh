#!/usr/bin/env bash
# Points a draft release at the commit this run built. A second release run into the same
# draft (RC2 after RC1) kept the first run's target_commitish, so publishing the draft would
# tag the first run's commit. A published release is left alone.
# Usage: set-draft-target.sh TAG SHA
set -euo pipefail

tag="${1:?tag required}"
sha="${2:?commit sha required}"

if [ "$(gh release view "$tag" --json isDraft --jq .isDraft)" != "true" ]; then
  echo "$tag is published; its target is left as is"
  exit 0
fi

current="$(gh release view "$tag" --json targetCommitish --jq .targetCommitish)"
if [ "$current" = "$sha" ]; then
  echo "$tag already targets $sha"
  exit 0
fi

# gh release edit keeps the tag name; an API PATCH without tag_name turns the draft untagged.
gh release edit "$tag" --draft=true --target "$sha"

after="$(gh release view "$tag" --json targetCommitish --jq .targetCommitish)"
if [ "$after" != "$sha" ]; then
  echo "::error::$tag targets $after after the edit, expected $sha" >&2
  exit 1
fi
echo "$tag now targets $sha (was $current)"
