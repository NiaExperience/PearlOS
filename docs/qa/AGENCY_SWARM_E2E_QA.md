# Agency Swarm E2E QA

This is the acceptance path for proving the Agency swarm feature is safe enough
to expose as a user workflow.

## Questions To Prove

1. An authenticated user can dispatch a tenant-scoped swarm.
2. The swarm can work inside its task workspace to produce a website artifact.
3. The swarm can operate on a fake accounting database without touching real
   customer, OAuth, source, deploy, or production data.
4. PearlOS webhook delivery returns a final output link for completed tasks.
5. Other users and tenants cannot read the task, artifact, workspace, event
   stream, or webhook side effects.

## Website Task

Use Launchpad or `/api/tasks` to create a `kind=swarm` task with requester
tenant/user scope and a workspace under `PEARL_PUBLIC_TASK_ROOT`. The worker must
write `index.html` in that workspace and complete the task with a result that
mentions the generated `index.html`. The task webhook bridge computes the final
artifact URL from the current task record, not from caller-provided webhook
metadata.

Required checks:

- completed task has requester tenant and user scope
- completed task has `webhook_notified_at`
- webhook metadata includes `artifactUrl`
- artifact URL returns `401` or `403` without user auth
- authenticated owner can fetch the artifact
- cross-tenant user cannot fetch the artifact
- direct gateway `/ws/events` rejects unauthenticated connections

## Accounting Sandbox Task

Do not mutate real finance data during QA. Use the sandbox harness:

```bash
python3 scripts/agency_accounting_sandbox_qa.py \
  --tenant-id tenant-a \
  --user-id user-a \
  --user-email qa@example.invalid \
  --label manual-check \
  --simulate-completion
```

The harness creates a SQLite ledger under the public task root, dispatches a
swarm-scoped task, applies a deterministic fake reclassification, writes
`audit.json` plus `index.html`, and marks the task complete so the webhook
bridge can deliver an artifact link.

Acceptance criteria:

- database path is under the task workspace
- all ledger queries include tenant scope
- `audit_events` stores before/after JSON
- `index.html` is produced in the task workspace
- task completion result mentions the workspace `index.html`
- webhook metadata includes the artifact link
- no real accounting connector, production database, OAuth account store, or
  PearlOS source/deploy path is read or mutated

## Security Passes

Run these as separate passes before prod:

- route auth: caller-supplied tenant IDs cannot override authenticated actor
- data scope: task/artifact/workspace access is tenant and user scoped
- path safety: artifact and accounting paths reject traversal and symlinks
- webhook safety: signatures required, current task is refetched, response
  bodies are not logged, duplicate terminal events do not double publish
- cost safety: swarm dispatch reserves tenant budget and rate limit
- release safety: prod interface must include `/api/tasks/webhook-event` before
  the gateway webhook bridge is promoted
