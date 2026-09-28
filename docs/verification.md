# Verification

This document records verification that belongs to Saturn IDE itself. Hardware profiles,
format-specific migration evidence, protocol implementation details and cloud-provider checks
belong with the corresponding project-owned source kit or integration repository.

## Core and architecture

The repository CI runs both TypeScript compilers, the architecture dependency guard and the
full Bun test suite. Core checks cover project validation, typed signals, physical topology,
source editing, retained revisions, installation fencing, SQLite persistence, reports,
resource indexing, language-service behavior and shell state.

The architecture guard verifies layer direction and forbids explicit `any` in product
TypeScript. It does not claim physical safety, protocol certification or visual fidelity of
an external extension.

## Project-owned extensions

Saturn treats copied extensions as ordinary TypeScript source. Resource discovery does not
execute them, and build/runtime activation happens only through explicit imports.

Generic acceptance fixtures verify that:

- `device()` is the single equipment-definition path;
- project-owned display factories can be supplied through `browser.ts`;
- protocol adapters remain outside core and bind through public acquisition contracts;
- importer extensions implement `ScadaImporter` without a global registry;
- importer output is confined to `imports/<importer-id>/`;
- import changes authored source only and cannot publish/apply a runtime revision;
- unsupported migration semantics remain explicit diagnostics/placeholders.

Implementation-specific acceptance belongs in the repository that owns that implementation.

## Runtime lifecycle

Tests cover immutable build transport, source/build/applied identity separation, publish/apply
compare-and-swap, restart restore, failed-start rollback, failed durable-write rollback,
fail-closed cleanup, command revision fencing and independent runtime execution.

The development host remains a convenience composition. Passing these tests is not evidence of
fault-tolerant production hosting or successful physical deployment.

## Browser and shell

Browser acceptance starts the actual local host and exercises project navigation, source editing,
2D/3D projections, telemetry, commands, alarms, reports, Git, responsive layouts and generated
Presentation elements. The terminal shell shares the same session/document contracts but does not
claim graphical parity.

Visual behavior owned by an external equipment/display extension is intentionally not asserted in
this repository.

### Local ACP Codex panel — 2026-09-28

On macOS arm64 with Bun 1.4.2 and Chromium:

- `bun test tests/browser-agent.test.ts`: **1 pass, 0 fail**. A child ACP agent
  completed initialize/new/prompt, requested permission, rejected an unknown option,
  and returned the approved reply.
- `bun scripts/agent-browser-test.ts`: **PASS** against a real Bun dev host and
  Chromium with the fake ACP child. The existing bottom panel connected, prompted,
  displayed a permission choice and reply, and stayed within a 390 px viewport with
  no page errors. Frames and WebM are in `artifacts/agent-panel/`; permission and
  mobile frames were visually inspected.
- A real `@agentclientprotocol/codex-acp@1.13.1` child connected through the same
  host adapter and answered a one-turn prompt with `ГОТОВО.`. In a separate
  disposable project it appended exactly `// ACP_EDIT_VERIFIED` to `project.ts`;
  the host observed the actual file, tool updates and final reply. The fixture
  was removed afterward. These checks establish local authentication, ACP
  transport and source-file editing, not engineering correctness or real-device
  safety.
- `bun run architecture:check`: **PASS**, 101 modules. `bun run check` remains
  **FAIL** in this branch because `@saturn/example` and `@saturn/protocols/*` imports
  in the existing scripts/tests are unresolved; no new agent-file TypeScript
  diagnostics were reported after this change. Full branch verification is open.

## Data and protocols

SQLite behavior is exercised in the default CI run. PostgreSQL cases require an explicit disposable
test database and are not reported as successful when skipped.

Protocol-neutral acquisition tests verify ownership, quality/timestamps, backpressure, command
serialization, reconnect behavior and cleanup. Concrete protocol adapters may have additional
wire-level tests in their own source-kit repositories.

## Hardware boundary

Saturn IDE does not claim that a controller has been flashed, that a pinout is certified, or that a
device-specific compiler/emulator is correct. Those claims require implementation-owned provenance,
toolchain tests and hardware acceptance outside the IDE repository.
