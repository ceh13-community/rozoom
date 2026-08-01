#!/usr/bin/env bash
# Install the built .deb into a clean distro environment (run inside a
# debian/kali container) and verify the app window actually renders.
#
# Catches the "installs fine, launches to a blank window" class of packaging
# bugs (webkit2gtk/DMA-BUF renderer mismatches etc.) that plain build success
# can never see.
#
# Usage: deb-render-smoke.sh <path-to-deb>
# Exit 0 = window rendered real content; non-zero = install/launch/render fail.
set -euo pipefail

DEB_PATH="${1:?usage: deb-render-smoke.sh <path-to-deb>}"
SHOT=/tmp/deb-smoke-shot.png
LOG=/tmp/deb-smoke-app.log
LAUNCH_WAIT="${LAUNCH_WAIT:-30}"
# A blank (uniform) window screenshots to a handful of unique colors; any real
# UI (text antialiasing alone) produces thousands. 500 keeps a wide margin on
# both sides.
MIN_UNIQUE_COLORS="${MIN_UNIQUE_COLORS:-500}"

fail() {
  echo "::error::deb-render-smoke: $1"
  echo "--- app log ---"
  cat "$LOG" 2>/dev/null || true
  exit 1
}

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  xvfb x11-utils x11-xserver-utils imagemagick procps dbus dbus-x11 xauth
# Installing via apt (not dpkg) resolves the deb's webkit2gtk/gtk deps exactly
# the way an end user's install would on this distro.
apt-get install -y -qq "$(realpath "$DEB_PATH")" || fail "deb failed to install"

PKG_NAME="$(dpkg-deb -f "$DEB_PATH" Package)"
BIN="$(dpkg -L "$PKG_NAME" | grep -m1 '^/usr/bin/' || true)"
[ -n "$BIN" ] || fail "no /usr/bin binary found in package $PKG_NAME"
echo "Package: $PKG_NAME, binary: $BIN"

Xvfb :99 -screen 0 1280x800x24 &
XVFB_PID=$!
export DISPLAY=:99
for _ in $(seq 1 20); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.5; done
xdpyinfo >/dev/null 2>&1 || fail "Xvfb did not come up"

dbus-run-session -- "$BIN" >"$LOG" 2>&1 &
APP_PID=$!

echo "Waiting ${LAUNCH_WAIT}s for app to launch and render..."
sleep "$LAUNCH_WAIT"

kill -0 "$APP_PID" 2>/dev/null || fail "app process exited during startup"

import -window root "$SHOT"
UNIQUE_COLORS="$(convert "$SHOT" -format '%k' info:)"
echo "Screenshot unique colors: $UNIQUE_COLORS (min required: $MIN_UNIQUE_COLORS)"

kill "$APP_PID" 2>/dev/null || true
kill "$XVFB_PID" 2>/dev/null || true

if [ "$UNIQUE_COLORS" -lt "$MIN_UNIQUE_COLORS" ]; then
  fail "window looks blank ($UNIQUE_COLORS unique colors on screen)"
fi

echo "OK: window rendered real content"
