# Verification — Shell, topology and reports, 2026-09-23

Base: `6a4fd0b295e88efd1805046996f9a8bd714db89b`.

## Actually executed in this change

Available local tools: Node **22.16.0**, TypeScript **5.8.3**. Bun and the new frontend dependencies are not installed. Registry installation failed because this execution environment cannot resolve external hosts.

Strict compilation of `src/core.ts`, `geometry.ts`, `topology.ts`, `motion.ts`, `reports.ts` and `tests/domain-contracts.test.ts` passed. Negative compiler assertions prove rejection of unknown signal names, wrong command values, read-only commands, invalid cable families/media, wrong pipe directions and nonnumeric report aggregation.

The emitted real domain code ran under Node's test runner: **8 passed, 0 failed**. This is not a mock router or a replacement report implementation. Covered:

- Exact XYZ endpoints and orthogonal routes; layout changes; obstacle avoidance; blocked terminal stubs.
- Runtime rejection of incompatible ports and double occupancy.
- Time-weighted integration: 10 m³/h for 30 minutes + 20 m³/h for 30 minutes = 15 m³.
- Missing/bad/stale intervals, coverage, clipped preceding observations and partial windows.
- CSV quoting/formula neutralization and phase integration/stopped or stale flow.

The actual `project/project.ts` was additionally transpiled and evaluated against that compiled core: **4 devices, 2 pipes and 2 cables; all four routes valid**. All new/modified TypeScript and TSX implementations were syntax-transpiled without diagnostics. Syntax transpilation is **not** a React/Three full typecheck or browser execution.

## Implemented gates, not claimed as passed

`bun run check` runs both native TypeScript 7 and compatibility TypeScript 6. `bun test tests` retains existing checks and adds the new domain suite and a real SQL report contract for SQLite/PostgreSQL. It checks a 400-observation report, deliberately larger than the chart's 300-observation limit.

`bun run test:browser` launches the actual `bun dev`. It exercises source/diagram drag before drop, RU/EN JSDoc, explicit cables, controls, alarms, SQL report coverage, history, Git, command navigation and actual WebGL frames. Screenshots are written only by this browser run: 2D, 3D, reports, desktop, tablet, phone and 320×240 HMI.

**The full dependency install, Bun startup, dual-version typechecks, SQL integration and browser workflow were not executed locally in this change. No screenshot or 3D quality parity is claimed from syntax tests.** No lockfile has been fabricated. The existing CI job saves the real lockfile only after a successful full run.

The preceding two GitHub Actions runs failed before any job step, with `runner_id: 0`. This is historical evidence, not proof that the new code passes CI. See the current commit's Actions run for its actual state.

## Deliberate scope

3D is a real Three renderer with cutaway equipment, measured animation, physical routed paths and shared port elevations. It is **not** certified dimensional CAD, a reconstruction of every old vendor asset, a hydraulic solver or physical PLC verification. Visual approval still needs inspection of the actual browser output.

Operator mode is a workspace mode, not authorization. Local runtime revision and Git state are shown separately. Published/applied revisions are not invented: remote deployment is explicitly unconfigured.
