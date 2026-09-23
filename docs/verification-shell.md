# Verification — isomorphic resource Shell, 2026-09-23

Base: saturn-ide 3442910bf9fe5ca5d7b07a71b44d052898028539.

## Executed locally

Node 22.16.0, installed TypeScript 5.8.3. This environment has no Bun executable or installed
React/OpenTUI/MDI application dependencies; external registry access failed with DNS resolution.
No current-version full application typecheck or dependency install is claimed.

The actual pure resource contract, ShellSession, Documents and SSE decoder passed strict
TypeScript compilation with noUncheckedIndexedAccess and noEmitOnError. Their emitted code ran
under Node's test runner: **10 tests passed, zero failed**. Tests cover common browser/terminal
commands, one buffer for shared source, stable resource IDs, capability refusal, dirty close,
concurrent save/new typing, conflicting save, late reload and fragmented UTF-8 SSE messages.

The actual TypeScript-AST resource index was syntax-transpiled and executed with test metadata:
**6 tests passed, zero failed**. Class/name/source identity, no duplicate file entry, read-only
plugin discovery, legacy multi-object files, ambiguous locations, PLC/plugin ownership and
stable identity after source movement were exercised. This is a unit fixture, not a physical
project, hardware driver or browser render. It was not independently fully typechecked locally.

The dependency guard checked the new/edited local source subset (18 modules), and its new
headless-Shell rejection tests passed: **2 tests passed, zero failed**. CI still checks the entire
repository, including unchanged runtime/workspace files. Syntax transpilation also covers 30
new/edited TS/TSX files; syntax checks do not establish renderer integration.

## Included, but not executed locally

- Updated real Bun server tests keep the existing simulation/manual-apply/deadlock scenarios;
  file writes now target the actual P-01.device.ts, and /api/resources is checked.
- Browser script still launches bun dev and exercises actual drag, JSDoc, commands, alarms,
  reports, Git, 3D, responsive/HMI viewports. Added device icon/source identity, Open as without
  duplication, moving phase and reduced-motion assertions.
- Real OpenTUI testRender mounts the actual TerminalView with a test document port; checks source
  rendering and a shared Shell save command. No terminal frames were fabricated locally.

Full Bun startup, dependencies, dual TypeScript 7/6 checks, SQL integration, browser/WebGL and
OpenTUI-native execution remain unverified in this environment. Check the current commit's
Actions result; previous runner failures do not prove this code is correct. No hand-written lock.

## Preserved/limited scope

Detailed symbols.tsx, scene3d.tsx, core.ts, geometry/topology, report calculation, runtime authority,
installation/CAS logic and source build implementation are not rewritten by this pass. The demo
is reorganized into actual device/report source files with the same model values. In scene.tsx,
only measured-animation ownership/scheduling is extracted; geometry remains unchanged.

There is now a shared resource/document/navigation model and two renderer implementations.
This does not claim terminal graphical SVG/3D, terminal IntelliSense, complete remote operations,
new arbitrary equipment extensibility, an independent runtime process, XLSX, firmware support
or full old-Saturn parity. All remaining capabilities.md obligations still apply.
