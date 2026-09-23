# MVP verification — 2026-09-23

The initial implementation is commit `ba471abbdb5f07d955dcbeee9f07ee3f1464d91b`.
This report distinguishes executed checks from tests that have only been written.

## Executed locally

Bun **1.3.0**, TypeScript **5.8.3**, Linux; these are the available local runtimes,
not the versions selected for the complete CI run.

```sh
bun test tests/core.test.ts tests/workspace.test.ts tests/language.test.ts \
  tests/git.test.ts tests/store.test.ts tests/runtime.test.ts
```

**11 passed, 1 skipped, 0 failed; 50 assertions.** PostgreSQL was explicitly
skipped because no PostgreSQL server was available. SQLite was a real native
Bun.SQL database, not a mock. Git tests used real temporary repositories.

The passing checks cover model validation, pipe geometry, numeric AST edits,
comment preservation, optimistic write conflicts, path/symlink confinement,
scaffolding, actual TypeScript alias resolution and RU/EN JSDoc/completion,
command/observation separation, alarm hysteresis and persisted acknowledgement,
stale telemetry, SSE initial snapshots and cancellation, SQLite restart/history,
and commits that preserve unrelated staged files.

An independent strict `tsc --noEmit` check also passed for `core.ts`, `geometry.ts`,
`source-edits.ts`, `protocol.ts`, `server/workspace.ts`, `server/language.ts`,
`server/events.ts` and the sample `project/project.ts`. This is **not** a claim
that the React frontend or the entire application passed a full typecheck.
All authored TypeScript/TSX files were additionally syntax-transpiled successfully.

## Full CI is blocked before execution

GitHub Actions run `35891898797`, job `107286150113`, failed with **zero steps**,
`runner_id: 0`, and an empty runner name. The job never executed install, typecheck,
unit tests or the browser test. The log endpoint returned BlobNotFound. The exact
account/infrastructure cause could not be retrieved through the available API.

The checked-in workflow targets Bun **1.4.2**, TypeScript **5.9.3**, a real
PostgreSQL 16 service and Chromium. No passing full-CI result is claimed.

## Not yet verified end to end

The complete `bun dev` application, React/CodeMirror browser workflow, PostgreSQL
adapter, full-project typecheck, Web Push delivery and responsive screenshots
still require the complete dependency installation and working CI environment.
The browser test is implemented, but screenshots have **not** been fabricated.
The dependency lock will be committed by CI only after all checks pass.

Physical PLC firmware and the hardware display backend are deliberately outside
this MVP. The scaffold requires an actual target toolchain; browser HMI is not
presented as physical-device verification.
