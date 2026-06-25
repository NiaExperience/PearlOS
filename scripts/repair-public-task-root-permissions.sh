#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/repair-public-task-root-permissions.sh [--fix] [--summary]

Checks PearlOS user task workspace ownership under PEARL_PUBLIC_TASK_ROOT
(default: /srv/pearl-user-workspaces). With --fix, repairs entries that are not
owned by PEARL_TASK_ROOT_OWNER:PEARL_TASK_ROOT_GROUP. If no owner/group override
is set, the task root's current owner/group is used as the expected owner.
Use --summary for release/preflight logs that should not list tenant paths.
USAGE
}

fix=0
summary=0
while [[ $# -gt 0 ]]; do
  case "${1:-}" in
    -h|--help)
      usage
      exit 0
      ;;
    --fix)
      fix=1
      ;;
    --summary|--redact-paths)
      summary=1
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

root="${PEARL_PUBLIC_TASK_ROOT:-/srv/pearl-user-workspaces}"
owner="${PEARL_TASK_ROOT_OWNER:-}"
group="${PEARL_TASK_ROOT_GROUP:-}"

if [[ "$root" != /* || "$root" == "/" ]]; then
  echo "Refusing unsafe task root: $root" >&2
  exit 2
fi

if [[ ! -d "$root" ]]; then
  echo "Task root does not exist: $root" >&2
  exit 1
fi

root_uid="$(stat -c '%u' "$root")"
root_gid="$(stat -c '%g' "$root")"
root_owner="$(stat -c '%U' "$root")"
root_group="$(stat -c '%G' "$root")"

if [[ -n "$owner" ]]; then
  if ! expected_uid="$(id -u "$owner" 2>/dev/null)"; then
    echo "Task root owner does not exist: $owner" >&2
    exit 1
  fi
  expected_owner="$owner"
else
  expected_uid="$root_uid"
  expected_owner="$root_owner"
fi

if [[ -n "$group" ]]; then
  if ! expected_gid="$(getent group "$group" | cut -d: -f3)"; then
    echo "Task root group does not exist: $group" >&2
    exit 1
  fi
  if [[ -z "$expected_gid" ]]; then
    echo "Task root group does not exist: $group" >&2
    exit 1
  fi
  expected_group="$group"
else
  expected_gid="$root_gid"
  expected_group="$root_group"
fi

if [[ -n "$owner" ]] && ! id -u "$owner" >/dev/null 2>&1; then
  echo "Task root owner does not exist: $owner" >&2
  exit 1
fi

if [[ -n "$group" ]] && ! getent group "$group" >/dev/null 2>&1; then
  echo "Task root group does not exist: $group" >&2
  exit 1
fi

mapfile -d '' mismatches < <(
  find "$root" -xdev \( ! -uid "$expected_uid" -o ! -gid "$expected_gid" \) ! -type l -print0
)

if [[ ${#mismatches[@]} -eq 0 ]]; then
  echo "public-task-root permissions: ok ($root tree owned by $expected_owner:$expected_group)"
  exit 0
fi

printf 'public-task-root permissions: %s mismatched path(s), expected %s:%s under %s\n' \
  "${#mismatches[@]}" "$expected_owner" "$expected_group" "$root" >&2
if [[ "$summary" != "1" ]]; then
  printf '  %s\n' "${mismatches[@]:0:40}" >&2
  if [[ ${#mismatches[@]} -gt 40 ]]; then
    printf '  ... %s more\n' "$((${#mismatches[@]} - 40))" >&2
  fi
fi

if [[ "$fix" != "1" ]]; then
  echo "Run with --fix to repair ownership." >&2
  exit 1
fi

printf '%s\0' "${mismatches[@]}" | xargs -0 chown "$expected_uid:$expected_gid"
echo "public-task-root permissions: repaired ${#mismatches[@]} path(s)"
