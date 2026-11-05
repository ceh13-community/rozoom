# Arch Linux package (rozoom-bin)

`PKGBUILD` for the official ROZOOM binary on Arch Linux and its derivatives. It
repacks the slim `.deb` of the matching GitHub release, so pacman installs the
same binary the release ships, with the same bundled kubectl and Helm.

There is no AUR package yet (the AUR is not accepting new maintainer accounts at
the moment). Until there is one, build from this directory:

```bash
git clone --depth 1 https://github.com/ceh13-community/rozoom.git
cd rozoom/packaging/arch
makepkg -si
```

`makepkg` installs `webkit2gtk-4.1`, `gtk3` and `hicolor-icon-theme` as
dependencies. Add `noto-fonts-emoji` (listed as optional): without it the icons
in the UI render as boxes. Then start **ROZOOM K8s Linter IDE** from the
application menu or run `rozoom-k8s-linter-ide`.

Pacman does not learn about new releases of a package built this way. To
upgrade, pull the repository and run `makepkg -si` again.

## Keeping it current

`pkgver` and `sha256sums` follow the latest published release:

```bash
./update-pkgbuild.sh          # rewrite PKGBUILD and .SRCINFO for the latest release
./update-pkgbuild.sh --check  # exit 1 when PKGBUILD or .SRCINFO lags behind the latest release
```

The checksum is the sha256 digest GitHub records for the release asset, so the
script downloads nothing large. Any other change to `PKGBUILD` needs `.SRCINFO`
regenerated with `makepkg --printsrcinfo > .SRCINFO`.

## Verifying on a clean system

```bash
./test-clean-arch.sh [git-ref]
```

runs the clone-and-build steps above inside a fresh `archlinux:base-devel`
container (needs Docker), checks the installed files, starts the app under Xvfb,
checks that the first screen was actually drawn and leaves the log and a
screenshot in `test-out/`. Run it before changing anything here. A real Arch
desktop with a GPU is not part of this check.
