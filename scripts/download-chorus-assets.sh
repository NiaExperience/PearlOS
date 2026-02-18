#!/usr/bin/env bash
set -euo pipefail

ASSETS=(
  "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx"
  "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin"
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/apps/chorus-tts"

if [[ ! -d "${TARGET_DIR}" ]]; then
  echo "❌ Target directory not found: ${TARGET_DIR}" >&2
  exit 1
fi

download_tool() {
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail --retry 3 --retry-delay 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$2" "$1"
  else
    echo "❌ Neither curl nor wget is available. Install one to continue." >&2
    exit 1
  fi
}

downloaded_any=0

for url in "${ASSETS[@]}"; do
  filename="$(basename "${url}")"
  destination="${TARGET_DIR}/${filename}"

  if [[ -f "${destination}" ]]; then
    echo "ℹ️ ${filename} already present at ${destination}, skipping download."
    continue
  fi

  echo "→ Fetching ${filename}"
  tmp_file="$(mktemp)"
  trap 'rm -f "${tmp_file}"' EXIT

  download_tool "${url}" "${tmp_file}"

  mv "${tmp_file}" "${destination}"
  chmod 644 "${destination}"
  echo "✅ Saved ${destination}"
  trap - EXIT
  downloaded_any=1
done

if [[ ${downloaded_any} -eq 1 ]]; then
  echo "🎉 Chorus assets downloaded to ${TARGET_DIR}"
else
  echo "✅ Chorus assets already present in ${TARGET_DIR}"
fi
