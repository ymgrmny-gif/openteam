# Finite Manager project loop — local implementation

Base: `feat/openteam-chat-handoff-20261010`, HEAD `0c16fcfdc5f609b88756195bbfa22c8dae6adc8f`, initially clean. Origin is third-party `afumu/openteam`; no push/merge. RemoteDesktopV2 was not read or changed.

## Root cause and state boundary

At the base commit, `src/background/controlHandlers.ts:127-133` posts a single ordinary `GROUP_MESSAGE_SEND`. A role named Manager has no special scheduling authority. `src/background/orchestrationRuntime.ts:249-257` advances only a registered active orchestration run; ordinary task replies have no run/stage/backlog association. The completed smoke task therefore cannot trigger another authorized job. The daemon's pending count measures control requests, not a project backlog.

The graph runtime already implements sequential/parallel stages and review branches. It did not persist the next-stage decision before its asynchronous dispatch (`orchestrationRuntime.ts:308-313` at base), and iframe preparation retries were recursive without a limit (`:523-546`). These are separate crash/recovery and liveness defects, not evidence that ordinary task posting ever implemented a project loop.

## Implemented behavior

- `project.start` validates a finite, user-provided ordered backlog and compiles Manager -> sole writer -> independent review for each item into the existing graph engine. Dependencies must precede their consumers. Execution is deliberately serial; EngineerA/B can alternate without shared writes.
- Each item records an owner, isolated `codex/` branch, absolute worktree, instruction and acceptance criteria. Manager, writer and reviewer must be different roles. Conflicting ownership and unfinished cross-chat project claims are rejected. OpenTeam holds logical dispatch leases; it cannot enforce filesystem permissions in a third-party MCP server. Reviewer must verify actual Git/worktree ownership.
- Review fail/REWORK loops back to the same task's Manager and writer; pass advances to the next Manager automatically. Review attempts are bounded (default 3, range 1..5), and the whole graph fits at most 200 node executions. Exhaustion blocks, never accepts unreviewed work.
- A pass requires a persisted `received` source reply, exact role/prompt/task and worker response correlation, `verified: true`, no failed criteria, and non-empty independent evidence. The reviewer is instructed to read actual files, run tests and check Git. These are model-supplied attestations, not cryptographic proof of tool execution; native tool attestation is outside this change.
- Flow snapshots prevent edits/deletion from changing an active run. Next-stage queue mutations and role prompt reservations use the existing serialized storage mutation path. Concurrent wakeups cannot dispatch the same queued stage twice.
- Startup and the existing keepalive alarm reconcile persisted completed replies and drain committed transitions. A reserved send without a completed reply is never replayed after reload. Lost ACK/send errors block with an explicit source-reconciliation reason; completion timeout is ten minutes. Iframe preparation has three retries before blocking. OS processes/tool jobs are not cancelled or modified by this scheduler.
- Pause retains correlation and the writer lease; already-running external tools may finish and their responses can be saved. Explicit resume consumes the original reply/queue without sending the same job again. Blocked runs need human source reconciliation and retain resource ownership. No automatic unblock or retry of uncertain work.
- Normal task sends, automatic role-error retries, manual resend and stage skip cannot bypass a project's lease or acceptance gate. The team page shows project blocked/paused state and reason, with safe pause/resume actions.
- No permission, manifest or DNR changes. No AI-site adapter changes. No ACP requirement or new external model dependency. Historical `msg-07cb3ac3-bd2f-4fb7-8eb8-52603a09f87b` is untouched.

## Entry point

Use a new project id once, with a **user-approved** finite backlog. Do not infer an RD2 backlog or permissions from earlier smoke messages. A repeat `project.start` with identical id/backlog returns its existing run; changed content for the same id is rejected.

```json
{
  "id": "authorized-project-001",
  "chatId": "YOUR_CHAT_ID",
  "managerRoleId": "MANAGER_ROLE_ID",
  "reviewerRoleId": "REVIEWER_ROLE_ID",
  "maxAttempts": 3,
  "tasks": [
    {
      "id": "TASK-001",
      "instruction": "User-approved concrete scope",
      "acceptance": "Specific source, test and Git acceptance checks",
      "ownerRoleId": "ENGINEER_A_ROLE_ID",
      "branch": "codex/authorized-task-001",
      "worktree": "C:/approved-isolated-worktree/task-001",
      "dependsOn": []
    }
  ]
}
```

An item with `requiresApproval: true` is rejected with BLOCKED before any send. Obtain the required authorization before submitting it. Prompt-level scope boundaries additionally prohibit production, credentials, native/OS actions and push/merge.

```powershell
node packages/openteamcli/openteamcli.mjs project start --file backlog.json
node packages/openteamcli/openteamcli.mjs project read --chat YOUR_CHAT_ID --id authorized-project-001
node packages/openteamcli/openteamcli.mjs project pause --chat YOUR_CHAT_ID
node packages/openteamcli/openteamcli.mjs project resume --chat YOUR_CHAT_ID
```

`task post` keeps its existing one-task semantics; it does not silently authorize a project. `project.read` exposes pending/running/completed/blocked/paused, reason and the underlying durable run.

## Verification and handoff

Automated regression coverage includes two-task continuation, REWORK, exhaustion, duplicate start/wakeup, stale responses, missing evidence, missing frames, immutable flow, cross-chat worktree conflict, pause/resume and crashes at both reply/transition checkpoints. All browser/site/tool responses in these tests are synthetic.

Final `npm run verify`: exit 0, strict TypeScript PASS, Vitest 736/736 across 86 files PASS, production build PASS. The first sandboxed full run failed only in localhost daemon tests with `connect EACCES`; rerunning with localhost access passed. `git diff --check` passed. Generated build/log files are ignored and are not committed.

Live read-only verification on 2026-10-10: daemon `127.0.0.1:19305` connected to OpenTeam v1.0.3, pending=0; the supplied development room has Manager/EngineerA/EngineerB/IndependentReviewer ready. Installed capabilities do **not** include `project.*` yet. CLI localhost access initially failed inside the sandbox; the same read-only command succeeded outside it. RemoteDesktop ping returned pong; no RemoteDesktopV2 filesystem operation occurred.

Live E2E and live Chrome reload/resume are **BLOCKED / NOT_RUN**. Browser connection returned `Browser is not available: chrome`; verified browser inventory contains only Codex In-app Browser and MCP Apps. The Chrome control skill prohibits substituting an unrelated automation mechanism after this transport failure. The installed extension was not reloaded, and no live role task was sent. Do not mark live acceptance PASS from these tests.

Next acceptance steps:

1. Connect Chrome through the browser plugin; keep active/uncertain tasks reconciled and reload only the OpenTeam extension from this repository's generated `dist/`.
2. Verify doctor, existing room/role data and advertised `project.start/read/pause/resume` capabilities.
3. Run an explicitly approved two-item backlog in isolated test worktrees, require actual source/test/Git readback by the reviewer, observe automatic task-two delivery, then completed.
4. Reload between committed review and next dispatch; confirm no duplicate source user turn. Reload with an uncertain in-flight send; confirm original-source reconciliation or blocked, never replay.
5. Keep RD2 main, production, OS/native state and credentials out of this acceptance test. Upstream push/merge remains prohibited.
