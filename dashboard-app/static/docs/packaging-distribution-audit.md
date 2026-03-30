# Packaging And Distribution Audit

Date: 2025-11-14

## Build Inputs

- `src-tauri/tauri.conf.json`
- `Dockerfile_linux_new.ver`
- `README.md`
- `download-binaries.js`

## Expected Outputs

- AppImage
- DEB
- RPM

## Audit Checklist

- `pnpm run check`
- targeted runtime tests pass
- `pnpm exec tauri build` completes for release build
- if Tauri RPM bundling stalls, run `pnpm run build:rpm` fallback
- packaged build includes bundled CLI assets required by the app
- packaged build writes desktop logs to the expected path
- packaged build can open shell/debug flows on a real cluster
- packaged build can export support artifacts to `~/Downloads`

## Distribution Notes

- verify release artifact naming is stable
- verify checksums are generated and published
- verify upgrade/install notes for Linux packages are current
- verify no staging-only DSN or endpoints are baked into production artifacts

## Sign-Off

- artifact set verified:
- operator:
- date:
- blockers:
  - `pnpm exec tauri build --bundles rpm -v` may stall after reporting RPM bundling
  - fallback artifact is currently produced by `scripts/build-linux-rpm.sh`

## Current Local Evidence

- artifact set verified: `partial`
- operator: local release hardening pass
- date: `2025-11-14`
- verified artifacts:
  - release binary: `src-tauri/target/release/rozoom-k8s-linter-ide` (`26M`)
  - debian package: `src-tauri/target/release/bundle/deb/ROZOOM_K8s_Linter_IDE_0.7.1_amd64.deb` (`322M`)
  - rpm package: `src-tauri/target/release/bundle/rpm/ROZOOM_K8s_Linter_IDE_0.7.1_x86_64.rpm` (`285M`)
- checksums:
  - `rozoom-k8s-linter-ide`: `8be78b2d88cb5fc676d6ecde9f02796181510c2a0c5fb77778cf539af02566cd`
  - `ROZOOM_K8s_Linter_IDE_0.7.1_amd64.deb`: `e39ae7ae67f6a8ba04095ec70257c1ea6ab663bd0681de11471755c94f068f07`
  - `ROZOOM_K8s_Linter_IDE_0.7.1_x86_64.rpm`: `f14c8b86d82bce674f4d2872aa2e815fdf84504a6308a7139756de19da4ed616`
- bundled release evidence:
  - `.deb` payload and `.rpm` payload were previously inspected with `rpm -qip` / `rpm -qlp`
  - bundled CLI assets are expected in packaged payload
  - desktop log path is documented as `~/.local/share/com.rozoom.k8s-linter-ide/logs/logs.log`
- local QA against packaged-web flow:
  - `pnpm build` succeeds for production build
  - `pnpm preview --host 127.0.0.1 --port 4173` is blocked in this sandbox with `listen EPERM`, so local Playwright smoke could not be used here as final release evidence
- remaining sign-off still required:
  - install/upgrade verification on a clean Linux host
  - manual upgrade-path verification
  - published checksum attachment in release notes/draft release
