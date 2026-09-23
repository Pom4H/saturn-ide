# Verification — architecture foundation, 2026-09-23

Base: `9be93be56bfb9ee6637d19c11273ea01c1d59b66`.

## Executed locally

Node 22.16.0 and installed TypeScript 5.8.3. No Bun executable and no application dependency
installation were available. An actual HTTPS registry request failed with DNS resolution error.

Strict compilation of `src/core/artifact.ts`, `src/runtime/installation.ts` and
`tests/foundation.test.ts` passed. The compiled actual implementation ran under Node's test
runner: **12 tests passed, zero failed**. The state-machine tests deliberately use fault-injected
installation/persistence handles; they do not pretend to communicate with a PLC or execute Bun.SQL.

Covered: immutable artifact transport, canonical hashing, tamper rejection, preparation before
stopping the working driver, failed startup rollback, failed durable write rollback, fail-closed
stop failure, accurate identity after post-commit activation failure, concurrent CAS requests,
shutdown, restore without publication, compatible reconfiguration without acquisition restart.

The executable architecture guard was tested against dependency violations:
**3 tests passed, zero failed**. New/edited TypeScript files were also syntax-transpiled;
syntax validation is not a complete application typecheck. Local dependency checks covered the
new modules; CI checks the entire checked-out source tree.

## Preserved without rewriting

`src/ide` was relocated to `src/shell` using the identical Git tree. In particular, the existing
app, 2D SVG, 3D, motion consumers, HMI and report UI source blobs are unchanged by this pass.
`core.ts`, geometry/topology/motion/report calculation and existing runtime engine/store/push/SSE
implementations remain the same blobs (the runtime files moved to their owning directory).
This proves absence of a renderer-source rewrite, not successful browser execution or visual parity.

## Added but not executed locally

The new dev composition builds artifacts and uses retained SQL builds, publish/apply CAS and the
installation manager. Added actual Bun/SQLite integration tests for retained revisions and manual
preview. Existing SQLite/Postgres, source/Git/DSL and browser checks were kept with updated imports.
The browser script still launches the actual `bun dev`, exercises 2D drag/JSDoc/commands/alarms/
reports/history/Git/command palette/3D, and captures real screenshots at the same viewport sizes.

**Full Bun startup, whole-repository dual-version typecheck, Bun.SQL/PG integration and browser/GPU
run have NOT been verified locally in this pass. No screenshot or full-CI success is claimed.**
The current Actions result must be checked separately; prior runs failed before receiving a runner.
No handwritten lockfile or invented test evidence is included.

## Readiness limits

The dev host remains one process, so import boundaries do not establish runtime fault isolation.
Runtime-only host/process isolation, live draft preview/release controls in Shell, project-owned
arbitrary equipment, full dimension/derived typing, Presentation/targets, report jobs/XLSX and replay
are still open acceptance criteria in `docs/capabilities.md`. This is a committed foundation and
partial migration, not a completed replacement of all previous Saturn functionality.
