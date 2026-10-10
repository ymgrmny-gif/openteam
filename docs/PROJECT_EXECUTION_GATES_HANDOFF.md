# Project execution gates — 2026-10-10 handoff

OpenTeam base `fe439860940c37a9bdd0f3d24c87e715fcd6c524`, branch `feat/openteam-chat-handoff-20261010`; existing source clean, one untracked source-audit report preserved. Local changes/commits only, no upstream push/merge.

## Exact defect in the preceding implementation

At base fe43986, `src/background/projectWorkspaceRuntime.ts:155` applied completed Manager phase JSON directly; `:215-220` compiled planning as a single terminal Manager stage. No independent coverage acceptance existed. `src/group/projectWorkspace.ts:105-108` checked dependency progress, while `src/background/projectWorkspaceRuntime.ts:210` compiled only the current task. Accepted prerequisites lost their source commit identity when dispatch moved to another engineer's worktree. No configured base/path/acceptance-level contract existed.

## Implemented gates

Current `src/background/projectWorkspaceRuntime.ts:222` reuses the durable graph engine. Planning is Manager → independent plan Reviewer; fail returns to the same Manager with a three-attempt/six-node limit. Only exact received Manager source identity, independent evidence and coverageVerified PASS allow valid 1..8 phases to be persisted. The last phase retains the entire original acceptance. Phase ownership and permission boundaries are inherited. Rejected/malformed plans generate no worker task.

Execution is Manager read-only readiness/assignment → independent readiness Reviewer → sole writer → independent delivery Reviewer. Readiness validates exact branch/worktree, clean full HEAD, configured base ancestry, exclusive allowed paths and **every exact accepted dependency commit** as consumer HEAD ancestors. Missing commits or integration conflict block before worker dispatch. REWORK repeats the same task and readiness gate within existing bounded limits. No automatic main merge/cherry-pick/reset. Persistence retains immutable execution contracts and dependency artifacts through reload; blocked state cannot be evaded through execute/resume.

`src/group/projectExecutionGate.ts:18` gathers accepted leaf commit artifacts, including parent dependencies and serial phase dependencies. Legacy green progress without a commit artifact is insufficient. `:47` validates delivery commit/base/branch/worktree, actual changed paths within ownership, source/contract/native acceptance level, and real native verification attestation for native work. Native acceptance and requirement traceability inherit from ancestor scope and cannot silently downgrade to source. Import rejects overlapping paths, traversal and non-full baseline SHA. Reimport includes the execution contract in conflict checks. Existing imports without a contract stay readable but cannot execute until explicitly reconciled; do not invent another id to bypass ownership.

UI import includes full Git baseline and exclusive allowed paths. CLI config uses:

```json
"execution": {
  "baseCommit": "FULL_40_CHARACTER_LOWERCASE_GIT_SHA",
  "allowedPaths": { "ENGINEER_A_ID": ["src/owned-a"], "ENGINEER_B_ID": ["src/owned-b"] }
}
```

Task metadata supports `acceptanceLevel` (`source`, `contract`, `native`) and `traceability` string identifiers alongside existing id/dependency/approval metadata. Literal relative files/directories are accepted, globs are rejected. Delivery's changedPaths means the complete actual delivery diff, excluding prerequisite commits already integrated before readiness; the Reviewer must independently inspect the Git range and ancestry.

## Validation and live evidence

`npm run verify` **exit 0**: strict TypeScript, **759/759 tests in 90 files**, production build. `git diff --check` exit 0. Existing Vite CJS/chunk-size warnings only, no manifest/permission changes. Log: ignored `test-artifacts/verify-project-gates.log`.

New regressions prove missing prerequisite artifact/consumer ancestry, dirty/wrong checkout, ownership/traversal/invalid SHA, mismatched/native-vs-synthetic acceptance, inherited native requirements, independent plan gate/rework bound, no worker dispatch before readiness, and persisted-store reload without bypass/duplicate. Previous automatic next task, phase progress, pause/late response and completion tests now exercise the added gates. These are synthetic tests, not live GPT/tool acceptance.

Live installed build was reloaded through the user-authorized RemoteDesktop on Chrome's verified OpenTeam details page (`cnccbifloajlkjglmiojkpimjciamlpe`, loaded from `~\OpenTeam_Evaluation\dist`). Doctor exit 0: daemon 19305 PID 39692, extension connected v1.0.3, project.import/execute capabilities. Live CLI negative probe supplied an invalid baseline: **exit 1 / `baseCommit must be a full lowercase Git SHA`**, demonstrating the new validation is loaded. It rejected before storing a workspace or sending a task. Existing RD2 room remained ready with **24 messages / four ready roles**. Historic pending message was not resent. RemoteDesktop session intentionally ended.

**NOT_RUN:** real two-task Manager → Engineer → Reviewer → next-task E2E and live reload-resume between task deliveries. Connection/reload/negative validation are live control-plane evidence only. The backlog was not imported or executed. Full RD2 Phase 0 remains open; no RD2 feature coding was started.

## RD2 correction and next gate

User authorized correcting the preflight findings. Eight RD2 documents (AGENTS, Manager Skill, TODO/handoff, engineering rules, roadmap, migration gate, progress) were corrected in separate local doc-only commit **`150d7656aaf0d7722fb50abfca233aee10516cdf`**. RD2 main clean afterward; source/config/test/OS/V1/production untouched, no push/merge. Current source acceptance remains a65a0cd9; 528/528 + boundary/doctor evidence is historical, not rerun here. Weighted product progress **15% unchanged**.

`RD2_CURRENT_BACKLOG_20261010.md` excludes historical done work and gives stable current IDs, explicit phase-audit cards, native auth-before-capture/input dependencies, acceptance levels, traceability and gated future tranches. It is a draft until full Phase 0 independent acceptance and actual exclusive audit worktree/base assignments are verified. Audit/execution task progress must never substitute for weighted RD2 product progress.

Limit: the extension validates durable, source-correlated **independent Reviewer attestations**. It does not run Git itself, cryptographically attest MCP commands, enforce MCP filesystem permissions or authorize OS changes. Actual sources/tests/Git/device readback remain mandatory Reviewer responsibilities. The legacy flat `project.start` interface is retained; RD2 uses the workspace contract flow documented here. Live feature acceptance cannot be claimed from these tests or the installed capability list.
