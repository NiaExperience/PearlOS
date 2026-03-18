#!/usr/bin/env bash
set -euo pipefail

VERSION=""
PAYLOAD_ROOT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --payload-root) PAYLOAD_ROOT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${VERSION}" || -z "${PAYLOAD_ROOT}" ]]; then
  echo "Usage: build-deb.sh --version <v> --payload-root <dir>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST_DIR="${REPO_ROOT}/installer/dist"
mkdir -p "${DIST_DIR}"

# Placeholder artifact during development:
# - Produces a tarball payload bundle that can be inspected.
# - The real Linux .deb is implemented in the `linux-installer` task.
OUT_TGZ="${DIST_DIR}/PearlOS_Payload_Linux_${VERSION}.tar.gz"
rm -f "${OUT_TGZ}"

echo "Creating placeholder payload tarball: ${OUT_TGZ}"
tar -czf "${OUT_TGZ}" -C "${PAYLOAD_ROOT}" .
echo "OK. Placeholder artifact created."

