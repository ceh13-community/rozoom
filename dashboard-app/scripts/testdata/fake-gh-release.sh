#!/usr/bin/env bash
# Fake gh for finalize-release-asset-names.test.ts: release assets kept in a JSON file
# ($FAKE_GH_STATE), manifests in a directory ($FAKE_GH_FILES); a rename onto an
# existing name fails with HTTP 422 like GitHub.
set -euo pipefail
state="$FAKE_GH_STATE"
log="$FAKE_GH_LOG"
echo "$*" >> "$log"
if [[ "$1" == "api" ]]; then
  shift
  method=GET
  if [[ "$1" == "-X" ]]; then method="$2"; shift 2; fi
  endpoint="$1"; shift
  case "$method $endpoint" in
    "GET repos/o/r/releases") echo 7 ;;
    "GET repos/o/r/releases/7/assets")
      if [[ "$*" == *'.[].name'* ]]; then jq -r '.[].name' "$state"
      else jq -r '.[] | "\(.id)\t\(.name)"' "$state"; fi ;;
    "DELETE repos/o/r/releases/assets/"*)
      id="${endpoint##*/}"
      jq --argjson id "$id" 'map(select(.id != $id))' "$state" > "$state.new" && mv "$state.new" "$state" ;;
    "PATCH repos/o/r/releases/assets/"*)
      id="${endpoint##*/}"; name="${2#name=}"
      if jq -e --arg n "$name" --argjson id "$id" 'any(.[]; .name == $n and .id != $id)' "$state" >/dev/null; then
        echo "gh: Validation Failed (HTTP 422)" >&2; exit 1
      fi
      jq --argjson id "$id" --arg n "$name" 'map(if .id == $id then .name = $n else . end)' "$state" > "$state.new" && mv "$state.new" "$state" ;;
    *) echo "fake gh: unexpected api $method $endpoint" >&2; exit 1 ;;
  esac
elif [[ "$1 $2" == "release download" ]]; then
  pattern=""; dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in --pattern) pattern="$2"; shift 2 ;; --dir) dir="$2"; shift 2 ;; *) shift ;; esac
  done
  cp "$FAKE_GH_FILES/$pattern" "$dir/$pattern"
elif [[ "$1 $2" == "release upload" ]]; then
  cp "$4" "$FAKE_GH_FILES/$(basename "$4")"
else
  echo "fake gh: unexpected $*" >&2; exit 1
fi
