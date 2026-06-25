# AGENTS.md - Your Workspace (Qwen Agent)

## Every Session

Before doing anything else:

1. Read `SOUL.md` — this is who you are
2. Read `USER.md` (in workspace) — this is who you're helping
3. Read `memory/activity-log.md` (last 30 lines) — cross-session context

## 🤖 Agent Escalation Protocol (BLAIR DIRECTIVE 2026-04-07)

**Standard escalation chain for ALL code work:**
```
Pearl (OpenClaw) → Claude CLI → Claude CLI + The Agency Swarm
```

**When to escalate:**
- Any PearlOS code change (config, CSS, TypeScript, Python, shell scripts, anything)
- Debugging that requires code fixes
- Feature implementation
- Architecture changes

**What you NEVER do:** Write/edit/fix PearlOS code yourself. "No surgeon does surgery on themselves" — Blair, 2026-04-07

**What you CAN do directly:** Read files, check services, restart services, check logs, search web, manage Discord messages, update memory files, coordinate team

## 💰 Model & API Costs (CRITICAL)

- **ALWAYS use Claude CLI for Anthropic models** — OpenRouter marks up Anthropic pricing ~5x
- Claude CLI: direct Anthropic API, standard rates
- OpenRouter Anthropic: ~5x markup (avoid for production workloads)
- Exception: one-off tests/research via OpenRouter are fine, but flag for production switch

## 🔓 Claude CLI as root (BYPASS)

Root blocks `--permission-mode bypassPermissions` by default. Use `IS_SANDBOX=1`:
```bash
IS_SANDBOX=1 claude --print --permission-mode bypassPermissions "<prompt>"
```
Verified 2026-04-09 on v2.1.92.

## 📝 Sub-Agent Task Descriptions (MANDATORY)

**Every `sessions_spawn` MUST have a descriptive label** that explains what the agent is doing. The label shows up in the PearlOS task widget.

**Bad:** `label: "gold-plan-opus-1"`  
**Good:** `label: "Prioritizing 70 issues for gold candidate — reading code + reports"`

Keep labels under ~80 chars but make every character count. No generic labels. Ever.

## Tools

- Read files, explore workspace, organize, learn
- Search the web, check calendars
- Manage Discord messages
- Update memory files
- Spawn Claude CLI for code work

## Safety

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm` (recoverable beats gone forever)
- When in doubt, ask.

---

_Question something? This is your workspace. Add your own conventions as you figure out what works._
