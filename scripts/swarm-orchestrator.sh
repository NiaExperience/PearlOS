#!/usr/bin/env bash
# ============================================================================
# swarm-orchestrator.sh — Pearl's persistent task orchestration loop
# Runs every 5 minutes via cron. Checks state, evaluates backlog priority,
# and dispatches work when the system has capacity.
# ============================================================================
set -euo pipefail

ORCHESTRATOR_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="$(dirname "$ORCHESTRATOR_DIR")"
STATE_FILE="/tmp/swarm-orchestrator-state.json"
BACKLOG_FILE="${WORKSPACE}/swarm-backlog.md"
ORCH_LOG="/tmp/swarm-orchestrator.log"

# ── Log helper ──────────────────────────────────────────────────────────────
log()  { echo "[$(date -Iseconds)] $*" >> "$ORCH_LOG"; }
info() { log "INFO  $*"; }
warn() { log "WARN  $*"; }
err()  { log "ERROR $*"; }

# ── System capacity check ───────────────────────────────────────────────────
check_capacity() {
    read -r load1 load5 load15 _ < /proc/loadavg
    load1="${load1%.*}"  # truncate to integer
    free_mb=$(free -m | awk '/^Mem:/{print int($7)}')

    if [ "$load1" -gt 25 ]; then
        warn "Load ${load1}x — above threshold (25). Skipping dispatch."
        return 1
    fi
    if [ "$free_mb" -lt 5000 ]; then
        warn "Only ${free_mb}MB free — skipping dispatch."
        return 1
    fi
    echo "$load1 $free_mb"
    return 0
}

# ── Check currently running tasks ───────────────────────────────────────────
check_tasks() {
    local claude_count=0
    local active_tasks=()
    local running_agents=""

    # Count claude processes
    claude_count=$(ps aux | grep -cE "[c]laude.*--print|[c]laude.*--permission|[p]earl-task-dispatch" || true)
    
    # Check pearl-task-list if available
    if command -v pearl-task-list &>/dev/null; then
        active_tasks=$(pearl-task-list 2>/dev/null | grep -c "running" || true)
    fi

    # Check PM2 status for known services
    running_agents=$(pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    procs = json.load(sys.stdin)
    for p in procs:
        name = p.get('name','')
        status = p.get('pm2_env',{}).get('status','')
        if status != 'online':
            print(f'DOWN: {name} ({status})')
except: pass
" 2>/dev/null || true)

    echo "$claude_count|$active_tasks|$running_agents"
}

# ── Priority scoring ────────────────────────────────────────────────────────
score_item() {
    # severity(1-5) + impact(1-5) - effort() = score
    # Used for backlog ordering
    :
}

# ── Evaluate backlog & dispatch ─────────────────────────────────────────────
dispatch_next() {
    local load free_mb
    read -r load free_mb < <(check_capacity) || return 0

    local claude_count task_count pm2_issues
    IFS='|' read -r claude_count task_count pm2_issues < <(check_tasks)

    # Don't dispatch if already running work
    if [ "$claude_count" -gt 1 ] || [ "${task_count:-0}" -gt 0 ]; then
        info "Busy: claude=$claude_count tasks=${task_count:-0}. Waiting."
        return 0
    fi

    # Read state file for what's been started
    local last_dispatched=""
    local dispatched_items=()
    if [ -f "$STATE_FILE" ]; then
        last_dispatched=$(python3 -c "import json; s=json.load(open('$STATE_FILE')); print(s.get('last_dispatched',''))" 2>/dev/null || echo "")
        while IFS= read -r item; do
            dispatched_items+=("$item")
        done < <(python3 -c "
import json
s=json.load(open('$STATE_FILE'))
for k,v in s.get('dispatched',{}).items():
    if not v.get('complete'):
        print(k)
" 2>/dev/null || true)
    fi

    # Built-in priority queue (ordered by priority score)
    local priority_queue=(
        "fix-sqlite-vec|5|5|2|sqlite-vec fix: rebuild vector embeddings pipeline"
        "reduce-openclaw-restarts|4|5|3|Reduce OpenClaw gateway crash loop (port 18789 collisions)"
        "reduce-interface-restarts|3|4|2|Interface: 195 restarts, investigate crash pattern"
        "fix-dashboard|3|3|2|Dashboard was broken (check if resolved)"
        "qa-pipeline|4|4|4|Design CI test suite for voice/text/UI interactions"
        "results-review|3|4|3|Adversarial review and quality analysis of agent outputs"
        "ui-ux-refinement|3|3|3|Polish pass on interface, mobile-first verification"
        "architecture-doc|2|3|2|Document comprehensive PearlOS architecture"
        "memory-pipeline-review|3|3|2|Audit memory write/read pipeline quality"
    )

    local state='{}'
    if [ -f "$STATE_FILE" ]; then
        state=$(cat "$STATE_FILE")
    fi

    for entry in "${priority_queue[@]}"; do
        local id sev imp eff desc
        IFS='|' read -r id sev imp eff desc <<< "$entry"
        
        # Skip if already dispatched and not complete
        local is_complete=false
        if python3 -c "
import json
s=json.loads('$state')
d=s.get('dispatched',{}).get('$id',{})
exit(0 if d.get('complete',False) else 1)
" 2>/dev/null; then
            is_complete=true
        fi
        if [ "$is_complete" = true ]; then
            continue
        fi

        # Score = sev + imp - eff
        local score=$((sev + imp - eff))
        info "Top candidate: $id (score=$score) — $desc"

        # Dispatch based on task type
        case "$id" in
            fix-sqlite-vec|memory-pipeline-review)
                info "Dispatching $id to pearl-swarm-dispatch (medium)"
                pearl-swarm-dispatch "$desc" --agents 3 --category development &
                ;;
            reduce-*|fix-dashboard|ui-ux-refinement)
                info "Dispatching $id to pearl-task-dispatch"
                pearl-task-dispatch "$desc" &
                ;;
            qa-pipeline|results-review|architecture-doc)
                info "Dispatching $id to pearl-swarm-dispatch (medium research)"
                pearl-swarm-dispatch "$desc" --agents 3 --category research &
                ;;
        esac

        # Update state
        python3 -c "
import json, os
s={}
if os.path.exists('$STATE_FILE'):
    s=json.load(open('$STATE_FILE'))
if 'dispatched' not in s:
    s['dispatched']={}
import datetime
s['dispatched']['$id']={
    'started': datetime.datetime.utcnow().isoformat() + 'Z',
    'complete': False,
    'description': '$desc'
}
s['last_dispatched']='$id'
json.dump(s, open('$STATE_FILE','w'), indent=2)
" 2>/dev/null || true

        info "Dispatched $id (PID: $!)"
        return 0
    done

    info "All backlog items dispatched or in progress."
}

# ── Mark tasks as complete ──────────────────────────────────────────────────
mark_complete() {
    local id="$1"
    if [ ! -f "$STATE_FILE" ]; then return 1; fi
    python3 -c "
import json, datetime
s=json.load(open('$STATE_FILE'))
if 'dispatched' in s and '$id' in s['dispatched']:
    s['dispatched']['$id']['complete'] = True
    s['dispatched']['$id']['completed_at'] = datetime.datetime.utcnow().isoformat() + 'Z'
    json.dump(s, open('$STATE_FILE','w'), indent=2)
    print('Marked $id complete')
" 2>/dev/null || true
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
    # Handle commands
    case "${1:-}" in
        status)
            echo "=== Swarm Orchestrator Status ==="
            check_capacity || true
            IFS='|' read -r cc tasks pm2 < <(check_tasks)
            echo "Claude processes: $cc"
            echo "Active tasks: $tasks"
            [ -n "$pm2" ] && echo "PM2 issues: $pm2" || echo "PM2: all online"
            [ -f "$STATE_FILE" ] && echo "State: $(cat "$STATE_FILE" | python3 -c 'import sys,json;s=json.load(sys.stdin);print(json.dumps(s.get("dispatched",{}),indent=2))')" || echo "State: none yet"
            ;;
        complete)
            shift
            for id in "$@"; do mark_complete "$id"; done
            ;;
        dispatch)
            dispatch_next
            ;;
        *)
            dispatch_next
            ;;
    esac
}

main "$@"
