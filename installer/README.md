# PearlOS Native Installer (Installer Only)

This directory contains cross-platform native installer tooling for PearlOS.

## Goals

- Produce native installers:
  - Windows: `.exe` (Inno Setup)
  - macOS: `.pkg` (pkgbuild + productbuild)
  - Linux: `.deb` (dpkg-deb)
- Bundle core runtimes (Node.js + Python) to reduce version drift.
- Install PearlOS to user space (default `~/.pearlos` / `%USERPROFILE%\.pearlos`).

## Build

From repo root:

```bash
node installer/build.mjs --platform windows
node installer/build.mjs --platform macos
node installer/build.mjs --platform linux
node installer/build.mjs --platform all
```

Artifacts are written to `installer/dist/`.

## Notes

- This tooling is intended for packaging and CI builds. It does not replace the developer setup scripts in `scripts/`.
- Platform-specific build scripts live under `installer/windows`, `installer/macos`, and `installer/linux`.
