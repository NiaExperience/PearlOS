# Task Control Implementation

**Status:** Partial - voice tools created, UI controls pending

## Created

### Voice Tools (✅ Done)
- **File:** `/workspace/nia-universal/apps/pipecat-daily-bot/bot/tools/task_control_tools.py`
- **Tools:**
  - `bot_stop_task(task_label, action)` - Stop/cancel/kill a running task
  - `bot_list_tasks()` - List all active sub-agents/background tasks

**Usage:** User can say "stop that task", "cancel the Call Button Fix", "kill it", etc.

## Pending

### UI Stop Buttons (🚧 TODO)
- **File:** `apps/interface/src/features/ActiveJobs/components/ActiveJobsWidget.tsx`
- **Need:** Add stop/cancel button to each running job card
- **Backend:** Need `/api/tasks/stop` endpoint in bot_gateway.py

### Implementation Plan:
1. Add stop button to `JobCard` component (only show when status='running')
2. Add `/api/tasks/stop` POST endpoint in `bot_gateway.py`
3. Endpoint calls OpenClaw session abort or sends stop message

## Anti-Duplicate Spawning Logic

**Problem:** Pearl spawns duplicate agents for the same task (e.g., 2x "Call Button Fix")

**Root Cause:** No checking before spawn - just blindly calls `sessions_spawn` even if an agent for that task already exists.

**Solution:** Before calling `sessions_spawn`:
1. Check if a session with similar label already exists and is running
2. If yes: skip spawn, use existing session
3. If no: safe to spawn

**Prevention Code (to add to Pearl's agent logic):**

```python
# Before spawning, check for existing similar tasks
existing_sessions = sessions_list(kinds=["subagent"], activeMinutes=10)
for session in existing_sessions:
    if similar_task_name(session.label, new_task_label):
        # Task already running, don't spawn duplicate
        return f"Already working on {session.label}, using existing agent"

# Safe to spawn
sessions_spawn(task=new_task_label, ...)
```

**Where to implement:** OpenClaw agent prompt/system instructions OR in the spawn tool itself as a guard

## Investigation Needed

### Unsolicited Spawning
**Problem:** Agents spawning when user didn't request anything

**Possible Causes:**
1. Heartbeat checks triggering spawns
2. Tool calls creating agents as side effects
3. Autocorrection/suggestion logic spawning without approval

**Next Steps:**
- Review recent voice session transcripts for unsolicited spawns
- Check if heartbeat logic is calling `sessions_spawn`
- Add logging before all spawn calls to track trigger source
