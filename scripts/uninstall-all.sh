#!/usr/bin/env bash
set -euo pipefail

YES="${YES:-}"

confirm_or_exit() {
  if [[ "${YES}" == "1" ]]; then
    return
  fi
  echo "This will remove project dependencies AND uninstall system tools."
  echo "Tools targeted: Node/npm, Python, Poetry, uv, Docker."
  read -r -p "Type YES to continue: " answer
  if [[ "${answer}" != "YES" ]]; then
    echo "Cancelled."
    exit 1
  fi
}

remove_project_dependencies() {
  echo "Removing project dependencies and build outputs..."
  find . -type d -name node_modules -prune -exec rm -rf {} +
  rm -rf .turbo .next dist coverage .clinic .jest-cache
  rm -rf apps/pipecat-daily-bot/ui/dist
  rm -rf apps/pipecat-daily-bot/bot/__pycache__ apps/pipecat-daily-bot/bot/.pytest_cache apps/pipecat-daily-bot/bot/.ruff_cache
  rm -rf packages/events/python/build packages/events/python/dist packages/events/python/.pytest_cache
  find . -type d -name .venv -prune -exec rm -rf {} +
  find . -type d -name venv -prune -exec rm -rf {} +
  echo "Project cleanup complete."
}

uninstall_python_tools() {
  echo "Uninstalling Poetry and uv..."
  if command -v pipx >/dev/null 2>&1; then
    pipx uninstall poetry || true
    pipx uninstall uv || true
  fi
  if command -v python >/dev/null 2>&1; then
    python -m pip uninstall -y poetry || true
    python -m pip uninstall -y uv || true
  fi
}

uninstall_system_tools_macos() {
  if command -v brew >/dev/null 2>&1; then
    brew uninstall --ignore-dependencies node || true
    brew uninstall --ignore-dependencies python || true
    brew uninstall --ignore-dependencies docker --cask || true
  fi
}

uninstall_system_tools_debian() {
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get remove -y nodejs npm python3 python3-pip docker docker.io docker-ce || true
    sudo apt-get autoremove -y || true
  fi
}

uninstall_system_tools_arch() {
  if command -v pacman >/dev/null 2>&1; then
    sudo pacman -Rns --noconfirm nodejs npm python python-pip docker || true
  fi
}

confirm_or_exit
remove_project_dependencies
uninstall_python_tools
uninstall_system_tools_macos
uninstall_system_tools_debian
uninstall_system_tools_arch

echo "Done. You may need to restart your terminal."
