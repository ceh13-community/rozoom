#!/usr/bin/env bash
# Release gate for the slim variant: the updater endpoint is compiled into the
# app binary from tauri.conf.json + tauri.slim.conf.json. If the slim overlay
# ever stops overriding plugins.updater.endpoints (config rename, merge-rule
# change, wrong --config path), the slim build silently inherits latest.json
# and every slim install gets "updated" to the full bundle. Assert on the
# built artifact, not the config files, same policy as the PostHog key gate.
#
# Usage: assert-slim-updater-endpoint.sh <slim.deb>
set -euo pipefail

DEB="${1:?path to slim .deb required}"
[[ -f "$DEB" ]] || { echo "deb not found: $DEB" >&2; exit 1; }

SLIM_ENDPOINT="releases/latest/download/latest-slim.json"
FULL_ENDPOINT="releases/latest/download/latest.json"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

dpkg-deb -x "$DEB" "$tmp/root"
# usr/bin also holds the sidecar CLIs (rozoom-kubectl, rozoom-helm); the app
# binary is the deb package name (rozoom-k8s-linter-ide).
bin="$tmp/root/usr/bin/rozoom-k8s-linter-ide"
[[ -f "$bin" ]] || { echo "app binary rozoom-k8s-linter-ide not found in $DEB under usr/bin" >&2; exit 1; }
echo "inspecting $(basename "$bin") from $(basename "$DEB")"

if ! grep -aqF "$SLIM_ENDPOINT" "$bin"; then
  echo "::error::slim binary does not contain the slim updater endpoint ($SLIM_ENDPOINT); tauri.slim.conf.json override did not apply" >&2
  exit 1
fi
# -F: the slim endpoint string does not contain "download/latest.json" as a
# literal substring, so a fixed-string match cannot false-positive on it.
if grep -aqF "$FULL_ENDPOINT" "$bin"; then
  echo "::error::slim binary still contains the full updater endpoint ($FULL_ENDPOINT); slim installs would be updated to full artifacts" >&2
  exit 1
fi

echo "OK: slim updater endpoint verified in built artifact"
