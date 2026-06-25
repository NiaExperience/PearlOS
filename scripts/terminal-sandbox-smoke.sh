#!/usr/bin/env bash
set -euo pipefail

warn_only=0
if [[ "${1:-}" == "--warn-only" ]]; then
  warn_only=1
fi

fail() {
  if [[ "$warn_only" == "1" ]]; then
    echo "terminal-smoke: WARN: $*" >&2
    exit 0
  fi
  echo "terminal-smoke: ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_cmd bwrap
require_cmd tmux

task_root="${PEARL_PUBLIC_TASK_ROOT:-/srv/pearl-user-workspaces}"
smoke_root="$task_root/.smoke"
workspace="$task_root/.smoke/terminal-$$"
mkdir -p "$workspace" || fail "cannot create smoke workspace: $workspace"
cleanup() {
  rm -rf "$workspace"
  rmdir "$smoke_root" 2>/dev/null || true
}
trap cleanup EXIT

if [[ -d "$task_root" ]]; then
  task_uid="$(stat -c '%u' "$task_root")"
  task_gid="$(stat -c '%g' "$task_root")"
  chown "$task_uid:$task_gid" "$smoke_root" "$workspace" 2>/dev/null || true
fi

if [[ -r /proc/sys/kernel/unprivileged_userns_clone ]]; then
  userns="$(cat /proc/sys/kernel/unprivileged_userns_clone)"
  [[ "$userns" == "1" ]] || fail "unprivileged user namespaces disabled"
fi

for wrapper in pearl-codex-sandbox pearl-claude-sandbox pearl-openclaw-sandbox; do
  command -v "$wrapper" >/dev/null 2>&1 || fail "missing terminal wrapper: $wrapper"
done

ro_binds=()
for candidate in /usr /bin /lib /lib64 /etc; do
  [[ -e "$candidate" ]] && ro_binds+=(--ro-bind "$candidate" "$candidate")
done

resolver_binds=()
if [[ -d /run/systemd/resolve ]]; then
  resolver_binds=(--dir /run --dir /run/systemd --ro-bind /run/systemd/resolve /run/systemd/resolve)
fi

parent_dirs=()
current="$(dirname "$workspace")"
while [[ -n "$current" && "$current" != "/" ]]; do
  parent_dirs=(--dir "$current" "${parent_dirs[@]}")
  current="$(dirname "$current")"
done

if ! bwrap \
  --die-with-parent \
  --share-net \
  --unshare-pid \
  --unshare-ipc \
  --unshare-uts \
  --proc /proc \
  --dev /dev \
  --clearenv \
  --tmpfs /tmp \
  "${ro_binds[@]}" \
  "${resolver_binds[@]}" \
  "${parent_dirs[@]}" \
  --bind "$workspace" "$workspace" \
  --chdir "$workspace" \
  --setenv HOME "$workspace" \
  --setenv PATH "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  --setenv TERM xterm-256color \
  --setenv COLORTERM truecolor \
  --setenv LANG "${LANG:-C.UTF-8}" \
  --setenv LC_ALL "${LC_ALL:-C.UTF-8}" \
  --setenv USER pearl \
  --setenv LOGNAME pearl \
  --setenv SHELL /bin/bash \
  --setenv TMPDIR /tmp \
  --setenv PEARLOS_TERMINAL_SANDBOX 1 \
  bash --noprofile --norc -lc '
    set -euo pipefail
    test "$PWD" = "$HOME"
    test -w "$HOME"
    pearl-codex-sandbox --version >/dev/null
    pearl-claude-sandbox --version >/dev/null
    getent hosts openrouter.ai >/dev/null 2>&1 || getent hosts app.pearlos.org >/dev/null 2>&1
  '; then
  fail "bubblewrap terminal command failed"
fi

if ! PEARLOS_TERMINAL_SANDBOX=1 HOME="$workspace" pearl-openclaw-sandbox --version >/dev/null 2>&1; then
  echo "terminal-smoke: WARN: OpenClaw sandbox launcher is not packaged; Codex/Claude launchers passed" >&2
fi

echo "terminal-smoke: passed"
