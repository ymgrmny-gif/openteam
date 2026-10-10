# RD2 Phase 0 live startup — 2026-10-10

User requested actual team startup. Existing room `chat-a7afea7b-0f97-494d-a6ef-33e3c1c5168d` has four GPT roles; no duplicate room/role was created. The finite two-report tranche is `rd2-phase0-audit-20261010`, source `RD2_PHASE0_LAUNCH_20261010.md`. Two clean audit worktrees were created at RD2 baseline `85f8be5fd64f9f0faa0f8f5da27d91532bdaab30` with exclusive report paths recorded in that file. Runtime is serial; EngineerB is queued after EngineerA's independent delivery acceptance, not parallel.

## Actual startup fault and correction

The installed role status was ready while Manager's runtime iframe was absent. `src/background/orchestrationRuntime.ts:586` checks the actual frame and exhausts three preparation attempts before any stage/prompt is created. The run then blocks. `projectWorkspaceRuntime.ts` previously allowed resume only from paused, leaving this proven unsent checkpoint unrecoverable after official `chat initialize` restored the roles.

`canResumeUnsentProjectRun` now admits only an exact initial iframe failure with zero stage runs, no persisted non-task message, original root pending checkpoint, no competing active run, ready/nonbusy/nonblocked target roles and actual ready frames. It reuses the original run and caps explicit preflight recoveries at three. Any created prompt/stage, uncertain send, malformed acceptance, permission or dependency block remains non-resumable. It neither edits storage out of band nor creates a new project id to escape the lease.

Synthetic focused tests cover recovered iframe, missing iframe refusal, reload/same run identity, duplicate resume refusal and uncertain delivery refusal. `npm run verify` **exit 0**, TypeScript PASS, **766/766 tests / 91 files**, build PASS. Existing Vite warnings only. No manifest/permission change.

## Live evidence and limits

Official CLI `project import` and `project execute` succeeded in creating the original checkpoint, initially blocked before delivery. `chat initialize` restored all four roles. The verified dist was reloaded through RemoteDesktop on exact Chrome extension details (`cnccbifloajlkjglmiojkpimjciamlpe`, loaded from `~\OpenTeam_Evaluation\dist`). Doctor confirmed connected v1.0.3 on daemon 19305. Official `chat activate`, `chat initialize`, then `project resume --id rd2-phase0-audit-20261010` resumed the **same** run `run-46364fa0-8d07-4f8e-bf61-adfed370347d` after extension reload. Workspace status running, active `pre-02-d`, 0/2 accepted. Single Manager prompt `msg-7d91efb2-6269-482e-b6d8-74accb45020c` transitioned pending → sent; Manager thinking. Sending is not completed source acceptance.

Full real audit delivery/review/automatic-next and live reload during a delivered worker task are not yet accepted. This is live initial checkpoint reload recovery, not synthetic evidence presented as live delivery resume. Full Phase0 integration (`PRE-02-I`) still requires both accepted report commits in an integrator checkout and independent 82-row/source/scope review. No feature backlog execution or native/device/OS/V1/production work, automatic merge/cherry-pick, push or historical pending resend. Product acceptance remains 15%. Read durable project state before any follow-up; never repost a sent/uncertain message.
