# Refactor verification — 2026-09-24

Basis: PR #2 at `8102363f082523724f0d739c16b04ee0ae41f45d`.
The CLI could not resolve github.com in the execution environment. Source was read
through the authorized GitHub API; copied originals were verified against Git blob
SHA values. This was not a successful CLI git pull.

## Ownership and preserved contracts

`LayoutEditing` owns the active gesture, derived numeric ranges, previews and the
per-file drain of completed gestures. `Documents` remains the only editable source
buffer and owns versioned writes. `useLayoutEditing` binds the operation to React;
Workbench keeps composition/navigation, not a second drag state machine.
No new Project/Signal/Topology model, dependency, package or plugin lifecycle was added.
The existing Scene/SVG/3D/CSS implementations and Workbench JSX were not changed.

A completed drag cannot auto-save later manual keystrokes. Active gestures are not
drained halfway through. Each file owns its own remapped ranges, and a stale runtime
snapshot cannot retire a newer preview. Cancellation restores the preceding draft.

ProjectPlugins keeps temporary acquisition within its lock cleanup scope. Partial
stage copies are cleaned up, stage replacement failure restores the old directory,
and local modifications are checked again immediately before replacement. Git remains
the default command runner; the optional existing-runner-shaped argument permits
network-independent tests with actual local Git. Source hash metadata remains compatible.

Lanmon recognition belongs to `shell/importers/lanmon.ts`, not universal core.
The generic inventory contracts stay in core and the public `saturn-ide/lanmon`
export is retained. Supported extensions, warnings, extraction bounds and exclusion
of credentials/script bodies are preserved. Classification is a data table.

## Executed locally

Linux x64, Node 22.16.0, TypeScript 5.8.3:
- 20 regression tests passed: 11 gesture/document cases, 6 plugin cases using actual
  local Git repositories, 3 Lanmon inventory cases.
- These exact new test bodies were transpiled to CommonJS; only `bun:test` test
  registration was replaced with `node:test`. Assertions and production code were
  unchanged. This is not a native Bun test run.
- Two additional Node fault-injection checks passed: partial cpSync failure and
  stage renameSync failure. Both preserved the old source, removed staging leftovers
  and allowed the next installation. Fault injection used the transpiled modules.
- Strict TypeScript + noUncheckedIndexedAccess passed for the headless gesture model,
  its actual Documents/source-edit dependencies and the Lanmon adapter/contracts.
- TS/TSX syntax transpilation passed for the locally retrieved/modified modules.
- Workbench JSX is byte-identical to the base. This is a source comparison, not a
  new visual/browser acceptance result.

The full repository's dual TypeScript/Bun/protocol/browser suite was not run locally:
Bun, the external fixture checkouts and the complete dependency installation were not
available. A green local subset is not evidence of full integration or visual parity.

## Measured scope

Workbench: 341 → 298 physical lines. This does not claim the whole system got smaller.
Using the same local per-function AST proxy as the preceding audit (not SonarQube):
- ProjectPlugins maximum function: 17 → 13; total: 44 → 46 with added safety checks.
- Lanmon maximum function: 18 → 2; total: 20 → 3.
- New headless LayoutEditing maximum function: 8; total: 28.

Physical LOC intentionally increases in the formatted plugin module and regression
tests. A lower line count is not used as a substitute for simpler ownership or behavior.
