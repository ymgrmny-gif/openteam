# Staged RD2 development and distinct progress — 2026-10-10

User requested implementation of the reviewed recommendations. OpenTeam base `0b98089a27bda4f6ba84dc1d9223b966f2895aae`; RD2 doc base `150d7656aaf0d7722fb50abfca233aee10516cdf`; both clean before this change.

## Implemented

Previous RD2 draft had broad feature tasks requiring approval as a whole and `rd2-009n` depending on `rd2-007n`. This stalled safe code/test work behind device operations and forced optional browser development to wait for native Screen Control. The revised **38-card** finite backlog has visible design/source/contract-test/device-acceptance stages, distinct safe and permission-required cards, and explicit security prerequisites. Browser source starts after Phase 0 and common authorization contracts/tests; real browser acceptance requires its own profile/action scope and trusted auth, without native UIA/input completion as a prerequisite. A regression checks the complete transitive dependency graph.

First real Windows delivery is one explicitly authorized temporary Support session: correct target → real current Viewer screen → one reversible action with independently observed result → disconnect with subsequent access denied. This narrow acceptance never substitutes for full milestones, managed Support, signed updates or the later comprehensive two-computer Support test. V1 remains protected.

Canonical RD2 plan is `E:/Projects/RemoteDesktopV2/docs/DEVELOPMENT_BACKLOG.md`; OpenTeam copy is `docs/RD2_CURRENT_BACKLOG_20261010.md`. Copies were hash-verified identical. RD2 roadmap, progress notes and root TODO/handoff now point to the same stages. No RD2 runtime/config/test, service/registry/credential, capture/input, V1 or production change. No upstream push/merge.

## Actual progress UI/store change

`src/teamPage/projectWorkspaceView.ts` labels backlog acceptance as **Task progress**, and separately displays an optional **Recorded product acceptance** snapshot with source, date and evidence. Optional fields are available in the import form and CLI configuration:

```json
"productProgress": {
  "percent": 15,
  "sourcePath": "E:/Projects/RemoteDesktopV2/docs/PROJECT_PROGRESS.md",
  "asOf": "2026-10-10",
  "evidence": "RD2-001/002/003 accepted; native milestones remain open"
}
```

Import requires explicit numeric 0..100 plus nonempty source/date/evidence. Missing record displays unknown, not inferred 0/100. Snapshot persists separately from task state and is included in idempotent reimport conflict checks. Tests prove accepted tasks can reach 100% while recorded product acceptance stays 15%. The record is a supplied dated ledger snapshot; OpenTeam does not automatically read the external file, recalculate product weights or refresh that snapshot. Do not present an old date as current acceptance. Changing an existing imported snapshot requires explicit reconciliation, not another id to evade a lease.

## Verification / live boundary

`npm run verify` **EXIT 0**: TypeScript PASS, **764/764 tests in 91 files**, Vite build PASS. Log `test-artifacts/verify-stage-plan.log` is locally ignored. Existing Vite CJS/chunk-size warnings only. No extension permission/manifest change.

New meaningful regressions: finite acyclic current backlog, all device/native cards individually approval-gated without gating safe parent groups, ready safe work continues while service-device permission is pending, browser lane has no transitive input dependency, real capture still requires native auth, task/product percentage separation, valid source-ledger import and invalid/missing snapshot proof rejection. These are synthetic unit tests, not live GPT or native device acceptance.

Installed OpenTeam dist was reloaded via the previously user-authorized RemoteDesktop exact Chrome extension details target. Live doctor: connected v1.0.3 / daemon 19305. Negative CLI probe with product percent 101 was rejected **EXIT 1** with `Product progress must be an explicit 0..100 ledger snapshot`, proving new validation is loaded; handler rejects before storing or sending any role task. RemoteDesktop session intentionally ended. Actual two-progress UI rendering was verified by DOM tests, not a live screenshot.

**Open gates:** full independent Phase 0 D01-D22/F01-F57/X01-X03 acceptance; real isolated toy Manager → Engineer → Reviewer → next-task E2E and live delivery reload-resume; exact actual worktree/path/base assignments before backlog import. No new RD2 GPT work or native feature work was launched here. Product acceptance remains **15% unchanged**, previous RD2 528-test evidence historical and not rerun. The backlog stays draft/not imported until these gates are resolved.
