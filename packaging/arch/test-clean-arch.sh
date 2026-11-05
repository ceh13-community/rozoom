#!/usr/bin/env bash
# Build and install rozoom-bin the way the README tells Arch users to, inside a
# fresh archlinux:base-devel container, then start the app under Xvfb.
#
#   ./test-clean-arch.sh [REF]      REF = branch or tag to clone (default: main)
#
# Needs Docker. The log and a screenshot land in ./test-out/. Prints
# COMMIT=<sha>, INSTALLED=<pkg>, APP_ALIVE=yes and APP_RENDERED=yes on success,
# exits non-zero otherwise. The container is capped at ARCH_TEST_MEMORY
# (default 3g) so the run cannot starve the host it shares.
# Software rendering only: a real Arch desktop with a GPU is not covered.
set -euo pipefail

ref="${1:-main}"
repo_url="${ROZOOM_REPO_URL:-https://github.com/ceh13-community/rozoom.git}"
image="${ARCH_IMAGE:-archlinux:base-devel}"
out="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test-out"
slug="${ref//\//_}"
mkdir -p "$out"

docker run -i --rm --name "${CONTAINER_NAME:-rozoom-arch-test}" \
  --memory "${ARCH_TEST_MEMORY:-3g}" \
  -e REF="$ref" -e REPO_URL="$repo_url" -e SLUG="$slug" -e HOST_UID="$(id -u)" \
  -v "${out}:/out" "$image" \
  bash -euo pipefail -s <<'IN_CONTAINER' 2>&1 | tee "${out}/test-${slug}.log"
pacman -Syu --noconfirm --needed git sudo xorg-server-xvfb imagemagick noto-fonts-emoji >/dev/null
useradd -m builder
echo 'builder ALL=(ALL) NOPASSWD: ALL' >/etc/sudoers.d/builder

# The README path, run as an unprivileged user with passwordless sudo for pacman.
cat >/usr/local/bin/build-rozoom <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
cd "$HOME"
git clone --depth 1 --branch "$REF" "$REPO_URL"
cd rozoom/packaging/arch
echo "COMMIT=$(git rev-parse HEAD)"
makepkg -si --noconfirm
EOS
chmod +x /usr/local/bin/build-rozoom
su builder -c "REF='${REF}' REPO_URL='${REPO_URL}' /usr/local/bin/build-rozoom"

echo "INSTALLED=$(pacman -Q rozoom-bin)"
for f in /usr/bin/rozoom-k8s-linter-ide \
         /usr/share/applications/ROZOOM_K8s_Linter_IDE.desktop \
         /usr/share/licenses/rozoom-bin/LICENSE \
         /usr/share/licenses/rozoom-bin/THIRD-PARTY-LICENSES.md; do
  if [[ -e "$f" ]]; then echo "OK      $f"; else echo "MISSING $f"; exit 1; fi
done

# Start the app as a second user with an empty HOME, wait 25 s, take a screenshot.
# A live process is not enough: when the webview fails to start, the window stays
# up with an empty page. The first screen draws a few thousand distinct colours,
# an empty window under a hundred, so demand at least 500.
cat >/usr/local/bin/run-rozoom <<'EOS'
#!/usr/bin/env bash
set -uo pipefail
export GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1
rozoom-k8s-linter-ide >/tmp/rozoom.log 2>&1 &
pid=$!
sleep 25
if ! kill -0 "$pid" 2>/dev/null; then
  echo "APP_ALIVE=no"
  tail -n 20 /tmp/rozoom.log
  exit 1
fi
import -window root /tmp/rozoom.png
kill "$pid"
echo "APP_ALIVE=yes"
colours="$(magick /tmp/rozoom.png -format '%k' info: 2>/dev/null || echo 0)"
if (( colours >= 500 )); then
  echo "APP_RENDERED=yes (${colours} colours)"
else
  echo "APP_RENDERED=no (${colours} colours)"
  tail -n 20 /tmp/rozoom.log
fi
EOS
chmod +x /usr/local/bin/run-rozoom
useradd -m tester
su tester -c 'xvfb-run -a -s "-screen 0 1280x900x24" /usr/local/bin/run-rozoom'
# The screenshot is copied out before the verdict, so a failed run leaves it to look at.
cp /tmp/rozoom.png "/out/arch-run-${SLUG}.png"
chown "$HOST_UID" "/out/arch-run-${SLUG}.png"
IN_CONTAINER

# Without -i above, bash reads an empty stdin and exits 0 having done nothing, so
# trust the markers rather than the exit code.
grep -q '^INSTALLED=rozoom-bin ' "${out}/test-${slug}.log" || { echo "test-clean-arch: package was not installed" >&2; exit 1; }
grep -q '^APP_ALIVE=yes' "${out}/test-${slug}.log" || { echo "test-clean-arch: app did not stay up" >&2; exit 1; }
grep -q '^APP_RENDERED=yes' "${out}/test-${slug}.log" || { echo "test-clean-arch: app window stayed empty, see ${out}/arch-run-${slug}.png" >&2; exit 1; }
echo "test-clean-arch: PASS (${ref})"
