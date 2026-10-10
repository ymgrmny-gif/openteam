# Project hierarchy, Manager phase planning and progress — handoff

Date: 2026-10-10. Base HEAD: c03af09fe6642a297c42f1e85a3e1058e30448a3 on feat/openteam-chat-handoff-20261010, initially clean. Local changes only; no upstream push/merge and no RemoteDesktopV2 filesystem operations.

## Root cause and boundaries

The original single-task continuation defect and its exact base lines are recorded in MANAGER_PROJECT_LOOP.md. The c03af09 solution accepts only a precompiled flat JSON backlog (`src/group/projectBacklog.ts`, `src/background/controlHandlers.ts` project.start). It has no TODO hierarchy, Manager phase-planning checkpoint or project progress model. The existing team page shows run/stage state rather than weighted parent/child acceptance. A role name alone cannot supply a missing backlog.

The new project dispatcher is `src/background/projectWorkspaceRuntime.ts:124` (prepareProject), with source-correlated reconciliation, and `:208` (flowForNode), which reuses the existing graph engine. TODO parsing, readiness and weighted acceptance are in `src/group/projectWorkspace.ts`; the expandable project panel is `src/teamPage/projectWorkspaceView.ts:21`. Startup/alarm, runtime replies and CLI commands invoke the same pump in background/index.ts.

## Delivered behavior

- Project -> heading/group -> task -> Manager phases, persisted in the existing serialized Chrome store. Import Markdown headings and nested checkboxes as a snapshot; fenced examples are ignored. Existing [x] marks are historical, not independent acceptance.
- Ordinary imported leaves first get a plan-only Manager request. Manager returns 1..8 bounded concrete phases, preserving the task owner and original acceptance; the final phase verifies integration of the full original task. Generated phases are not recursively decomposed. The project has at most 300 hierarchy nodes.
- Each executable phase uses the existing Manager -> sole Engineer -> IndependentReviewer flow. PASS requires the core source/task/worker correlation and verified evidence. REWORK stays on that phase, with bounded review attempts. Completion automatically starts the next ready phase/task, and the finite project becomes completed at full acceptance.
- Parent progress is a weighted aggregation of independently accepted children. Unverified accepted labels, plans, historical marks and REWORK never increase progress. The percentage describes this imported task tree; it does not recalculate RD2's official product acceptance percentage.
- The panel shows goals, status, percent, accepted/open counts and expandable task details: owner, acceptance, dependencies, source line, evidence, source replies and event history. English, Turkish and Chinese labels are provided.
- Explicit Start authorizes the imported development scope once. Import alone dispatches nothing. Pause preserves prompt correlation and resource leases; resume consumes the original source without replay. Blocked projects retain their lease and reason and cannot be restarted/resumed to bypass reconciliation.
- Separate engineer role/branch/absolute worktree assignments are required. Workspace leases also cover the gaps between separate phase runs. Manual tasks, conflicting projects, chat history deletion and assigned-role deletion cannot bypass an unfinished workspace.
- No manifest, permissions, DNR or AI-site adapter changes. No production/native/OS/credential actions or automatic permission grants. Explicit approval-required nodes are held; prompts also forbid unsafe scope even if Manager omitted a flag. These are dispatch restrictions, not filesystem enforcement in third-party MCP servers. Reviewer evidence is source-correlated model attestation, not native cryptographic tool attestation.

## Usage

In a chat, click **Proje / Project**, select TODO.md, enter the project goal and authorized scope, select Manager/IndependentReviewer and assign isolated engineer branches/worktrees. Import, inspect the task tree, then Start. Expand tasks to see phases and evidence as the store updates.

CLI configuration (actual room/role identifiers and user-authorized isolated worktrees are required):

```json
{
  "id": "example-project-001",
  "chatId": "ROOM_ID",
  "name": "Example project",
  "goals": "User-authorized bounded development scope and acceptance goals",
  "managerRoleId": "MANAGER_ID",
  "reviewerRoleId": "REVIEWER_ID",
  "engineers": [
    { "roleId": "ENGINEER_A_ID", "branch": "codex/example-a", "worktree": "C:/Projects/example-a" },
    { "roleId": "ENGINEER_B_ID", "branch": "codex/example-b", "worktree": "C:/Projects/example-b" }
  ]
}
```

```powershell
npm run openteamcli -- project import --file project.json --todo TODO.md
npm run openteamcli -- project execute --id example-project-001
npm run openteamcli -- project read --chat ROOM_ID --id example-project-001
npm run openteamcli -- project pause --id example-project-001
npm run openteamcli -- project resume --id example-project-001
```

Optional TODO metadata on headings/checkboxes:

```markdown
# Windows service
- [ ] Contract <!-- openteam: {"id":"contract","weight":2,"executable":true,"acceptance":"Read sources and verify contract tests/Git ownership"} -->
- [ ] Integration <!-- openteam: {"id":"integration","dependsOn":["contract"]} -->
- [ ] Native install <!-- openteam: {"id":"native","requiresApproval":true} -->
```

`executable:true` opts a sufficiently concrete task directly into the existing delivery/review flow. Default tasks receive Manager planning first. Dependencies must exist and be acyclic. A task cannot depend on a parent containing itself. Reimport with the same id/config/source is idempotent; changed source is rejected to preserve acceptance.

This version imports a **snapshot**. It does not watch the disk, modify the original TODO or automatically merge a changed TODO into accepted work. There is no automatic blocked-project release, uncertain resend or approval-grant button. Resolve the original source/permission condition explicitly; do not create another id to evade a retained lease.

## Acceptance and live boundary

Synthetic regressions cover nested parsing, historical checkboxes, weights, dependencies, phase limits, writer inheritance, integrated acceptance, automatic next phase/task, completion, persisted-store reload with no duplicate sends, REWORK, pause with a late original reply, approval gates, malformed Manager output, idempotent import and safe expandable UI. Existing runtime tests cover stale source replies, missing proof, bounded retry, crash checkpoints and conflicting ownership. These are automated synthetic tests, not live GPT/tool acceptance.

Read-only live doctor on 2026-10-10 returned exit 0 / ok=true: daemon 19305 reachable and extension v1.0.3 connected. The installed extension now advertises the previous flat project.start/read/pause/resume, but DOES NOT advertise the new project.import/execute/workspacePause/workspaceResume. Therefore the new hierarchy is built locally but not live-installed or live-accepted. No live role task was sent; the historic pending prompt was untouched. Previous Chrome transport limitation is documented in MANAGER_PROJECT_LOOP.md. Reload the generated dist through the authorized Chrome surface before live acceptance; do not mistake a build for an installed extension.

Final validation: see the verification entry below and TODO.md. Required next live acceptance: load the build, preserve existing room state, run two explicitly scoped toy tasks in isolated worktrees, verify actual source/test/Git evidence, observe automatic next dispatch, and reload between acceptance and dispatch to verify no duplicate real user turn. RD2 native/product acceptance remains separate.

Final verification (2026-10-10): `npm run verify` exit 0; strict TypeScript PASS; Vitest 750/750 in 89 files PASS; Vite production build PASS. `git diff --check` PASS. Only pre-existing Vite CJS/chunk-size warnings; no permission/manifest change. Verification used localhost access for daemon tests. Generated dist/logs are not committed.
