# Verification — architecture foundation, 2026-09-23

## Diagram terminal levels, 2026-09-24

The bottom dock's CMD tab is now Terminal / Терминал. It keeps signal commands
and displays three filterable levels: error, warn and info. Its entries come
from accepted or rejected commands, current Shell/build errors, runtime
connection and driver state, and the persisted alarm-event API refreshed when
SSE reports an alarm. An active alarm is a warning; clear and acknowledgement
are informational. This is an IDE/runtime event view, not a capture of stdout
or stderr from an external PLC process.

On macOS arm64 with Bun 1.4.2, `bun run check` passed both TypeScript checks
and `architecture:check` (56 modules); `bun test tests` passed 84 tests with
2 PostgreSQL tests skipped and 0 failures. The Playwright Chromium scenario
`bun scripts/interaction-test.ts` passed at 1440×960 with no page errors. It
exercised all three levels, the error filter, a real high-pressure alarm
transition and clear, command writes, and the existing 2D/3D interactions.
The inspected frame is `artifacts/diagram-dock-terminal.png`.

## Diagram bottom panel and Select/Edit, 2026-09-24

The 2D and 3D diagram now share a bottom dock with Equipment, Graphs and CMD
tabs. The former large equipment strip and floating trend no longer occupy the
diagram. Selecting PLC-01 shows its own signal and signals from connected
equipment; disconnecting a plug removes the cable signal from the detached
equipment context. The graph combines selected instruments and separates
boolean and numeric units. CMD accepts typed `set` commands through the
existing runtime command API and labels acceptance separately from observed
confirmation. The dock can be expanded, and its tabs remain available in both
dimensions.

On macOS arm64 with Bun 1.4.2, `bun run check` passed both TypeScript checks
and `architecture:check` (55 modules); `bun test tests` passed 84 tests with
2 PostgreSQL tests skipped and 0 failures; `git diff --check` passed. The
focused Playwright Chromium script `bun scripts/interaction-test.ts` passed
at 1440×960 with no page errors. It exercised CMD stop/start, PLC readings,
2D and 3D multi-selection, Select versus Edit movement, and cable rewire,
unplug and reconnect in both dimensions. The inspected screenshots are
`artifacts/diagram-dock-cmd.png`, `artifacts/diagram-dock-plc-signals.png`
and `artifacts/select-trend-3d.png`. The separate full browser suite was not
rerun in this pass; its prior source-editor `1450 rpm` assertion remains an
unresolved known failure.

## PLC500 2D WASM screen, 2026-09-24

The 2D equipment SVG now places an HTML canvas inside its existing screen
opening and composes the same project-owned Firmverse display factory used by
3D. Both projections receive RGB565 pixels from Firmverse WASM, current runtime
observations and the autoHmi page compiler. Transparent hit targets over the
four existing SVG keys call the display driver; keyboard arrows work when the
canvas has focus. The screen layout was adjusted so its title, footer and
1450.0 RPM value fit at 320×240. The SVG body and port artwork were retained.

On macOS arm64 with Bun 1.4.2, `bun run check` passed dual TypeScript checks
and `architecture:check` (52 modules). The focused core/PLC/route/server suites
passed 15/15, and `git diff --check` passed. In Chromium at 1440×960, the 2D
screen reported `firmverse-wasm-rgb565`, had five distinct pixel colors, and
all four keys changed pages 0→1→2→1→0. A runtime stop changed the screen
pixels, restart changed them again, and ArrowRight advanced to page 1; the
page produced no browser errors. The inspected screenshot is
`artifacts/interfaces-2d-wasm-live.png`.

The full `SATURN_CAPTURE_ARTIFACTS=1 bun run test:browser` run passed its new
2D screen/key assertions, then failed at the earlier source-editor expectation
for a `1450 rpm` live-value comment. It is not claimed as passing.

## Standard interfaces and Firmverse RGB565 frame, 2026-09-24

The authored Terminal now carries a standard connector profile plus optional
signal value type/unit. The shared profile catalog covers RJ45 Ethernet,
RS-485, control screw terminals, power terminals and fluid flanges. The PLC500
project definition includes ETH, RS-485, AC L/N, DC +/- and its existing control
ports. The compiler checks connector/medium/family combinations; project
validation checks port shape, cable medium/family/direction, signal type and
unit. The diagram and 3D scene read those authored ports. This is a catalog
of interface profiles, not a claim of physical pinout certification.

Firmverse was extended in the isolated worktree
`/Users/rom/Documents/firmverse-saturn-framebuffer` on branch
`codex/saturn-framebuffer` at commit `04e9aef`, based on upstream commit
`2a960fd`. Its pinned
FBD screen callbacks now rasterize a 320×240 RGB565 buffer in C/WASM. The
project-owned package copy and manifest were rebuilt from that source. The
IDE transfers RGB565 pixels to the CanvasTexture; JavaScript no longer
rasterizes draw commands for the 3D display. The LCD font is illustrative;
image assets without a target registry fail explicitly. This is an emulator
frame, not a physical display memory read.

On macOS arm64 with WASI SDK 24, the Firmverse package rebuilt and its Node
test suite passed 9/9, including a no-step RGB565 render test. With Bun 1.4.2,
`bun run check` passed both TypeScript checks and `architecture:check` (52
modules). `bun test tests/core.test.ts tests/saturn-plc500.test.ts
tests/route3d.test.ts tests/server.test.ts` passed 15/15; `git diff --check`
passed. Chromium WebGL at 1440×960 found all inspected PLC500 port IDs in
2D, saw distinct digital/analog cable strokes, and rendered the PLC500 with
`data-screen-source=firmverse-wasm-rgb565`, 4 screen updates, 33 frames,
0 invalid routes and 0 page errors. The inspected frames are
`artifacts/interfaces-2d-final.png` and `artifacts/interfaces-3d-final.png`.
The full browser acceptance suite was not run in this pass.

## Dev startup recovery, 2026-09-24

On macOS arm64 with Bun 1.4.2, `bun test tests/server.test.ts` passed: 4 tests, 0 failures, including the retained-build restore regression. `bun run check` passed both TypeScript checks and `architecture:check` (49 modules). An actual `bun dev` startup using the existing local SQLite database reported the incompatible applied build and stayed offline with its applied identity intact. After backing up that database and clearing its obsolete simulation publish/apply pointers, `bun dev` started in simulation mode; `/api/state` reported `pumping-station`, four equipment instances and no problems. This checks startup and API state, not browser rendering or physical driver behavior.

## 3D bends and PLC500 view, 2026-09-24

On macOS arm64 with Bun 1.4.2, `bun test tests/route3d.test.ts tests/core.test.ts tests/revisions.test.ts` passed (8 tests, 0 failures). `bun run check` passed both TypeScript checks and `architecture:check` (50 modules). A Playwright Chromium WebGL session against the running `bun dev` at 1440×960 rendered 58 frames with 4 routes, 0 invalid routes, and 8 rounded pipe bends; no page errors were reported. The 1204×699 canvas and document scroll size remained unchanged after 5.2 seconds idle. Hero and side screenshots were inspected; the PLC500 front SVG appeared on the extruded body and the same route remained connected. Wheel zoom and pointer orbit were exercised. The PLC500 body is illustrative, not CAD-derived. `SATURN_CAPTURE_ARTIFACTS=1 bun run test:browser` failed before reaching 3D because the source editor did not show the expected `1450 rpm` live-value comment within 15 seconds; that full browser suite is not claimed as passing.

## PLC500 mesh and live screen, 2026-09-24

On macOS arm64 with Bun 1.4.2, `bun run check` passed both TypeScript checks and `architecture:check` (51 modules). `bun test tests/core.test.ts tests/route3d.test.ts tests/server.test.ts` passed (11 tests, 0 failures). Chromium WebGL rendered the project-owned PLC500 mesh with terminal groups, four raised navigation keys and a ShaderMaterial screen fed by a CanvasTexture of current project observations. In the simulator, a stop command changed measured RPM from 1450 to 0, the screen continued updating, and a start command restored RPM to 1450. Hero, focused and side screenshots were inspected; a double-click focused PLC-01. The 1204×699 canvas and 1440×960 document scroll size stayed fixed over 5.2 seconds, screen updates advanced from 13 to 34, and no page errors appeared. After visual review, the enclosure was reduced to a thin hard-edged 16-unit illustrative shell with ports moved to its top elevation; the final focused screenshot was inspected. The screen is a runtime observation preview with simulated pixelation, not the physical PLC firmware framebuffer or a CAD-derived display.

## PLC500 monolithic chassis and socket alignment, 2026-09-24

On macOS arm64 with Bun 1.4.2, the enclosure was rebuilt as one extruded mesh with a 16-unit depth. Terminal blocks, sockets, four keys, and the live screen remain separate meshes. Authored control ports share the socket elevation (26 units), and cable geometry includes a riser over each control-panel endpoint. `bun test tests/core.test.ts tests/route3d.test.ts tests/server.test.ts` passed (12 tests, 0 failures). `bun run check` passed both TypeScript checks and `architecture:check` (51 modules); `git diff --check` passed. A real Playwright Chromium WebGL session focused PLC-01, rendered 37 frames and 16 screen updates with 0 invalid routes and 0 page errors. Focused and near-profile screenshots were inspected: the formerly separate backing slab is absent, the thin chassis edge is visible, and cables meet the terminal rows. This is an illustrative enclosure and socket layout, not a CAD-derived physical fit test.

## PLC500 end-face ports, 2026-09-24

The previous version placed visible sockets on the top of the terminal blocks; that orientation was incorrect. Their meshes now face outward from the upper or lower terminal end walls, with the authored port coordinate on that wall. Cable geometry departs each socket along the port side before rising to its route. A direct check over the ten PLC-01 ports found every port on its matching terminal group's end face. On macOS arm64 with Bun 1.4.2, `bun run check` passed (51 architecture modules) and `bun test tests/core.test.ts tests/route3d.test.ts tests/server.test.ts` passed (12 tests, 0 failures). In a Playwright Chromium WebGL run at 1440×960, focused and side views were inspected; the terminal openings were visible on the end face. Over 5.2 idle seconds, the 1204×699 canvas and 1440×960 document scroll size stayed fixed; screen updates advanced from 40 to 65, routes remained valid, and there were no page errors.

## PLC500 autoHmi and WASM screen, 2026-09-24

The earlier 3D screen used `drawControlDisplay` and reduced a Canvas frame to 96×72 in the shader. That did not use `autoHmi` or Firmverse screen output. The new project-owned display derives overview/detail pages from `project.hmi` when `source='topology'`, compiles them through pinned Firmverse WASM, passes current good observations to WASM inputs, and calls `renderScreen`. The returned commands are rasterized in Canvas at 320×240 and sampled as a native-resolution screen texture. Missing or stale values show `NO DATA`; all four 3D buttons change pages. This is actual WASM HMI command output, but the pinned binary does not expose a pixel framebuffer; Canvas performs final pixel rasterization. `bun run check` passed dual TypeScript checks and 51 architecture modules. `bun test tests/saturn-plc500.test.ts tests/core.test.ts tests/route3d.test.ts tests/server.test.ts` passed (14 tests, 0 failures). In Chromium WebGL, the screen reported `firmverse-wasm`, 0 invalid routes and no page errors. Pointer clicks on all four buttons changed pages in order 0→3→0→1→0; keyboard ArrowDown changed page 1→2. Overview and detail screenshots were inspected at 1440×960, including a close view with legible values and labels.

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

## Shell UX iteration and supplied sidebar reference, 2026-09-24

Executed on macOS arm64 with Bun 1.4.2. `bun run check` passed both TypeScript
checks and `architecture:check` (57 modules). `bun test tests` passed 85 tests,
with 2 PostgreSQL tests skipped because no PostgreSQL service was configured;
the terminal renderer test emitted React `act(...)` warnings but passed.
`git diff --check` passed.

`bun scripts/shell-audit.ts` used a real Playwright Chromium browser and
simulated runtime at 1440×960, 1024×768 and 390×844. It opened all eight Shell
sections, captured 19 frames, checked desktop sidebar toggle, mobile navigation,
mobile 2D zoom and surface actions, and found no page errors or horizontal page
overflow at 390 px. The checked, published and applied hashes were identical,
and `/api/semantic/diff` returned no changes. The screenshots were inspected in
light and dark themes. `bun scripts/interaction-test.ts` passed the 2D/3D
multi-select trend, equipment drag, and persisted cable rewire/unplug/reconnect
scenarios with no page errors. The browser scripts use the fixture project and
simulator; they do not verify physical equipment, PostgreSQL, or every stale
and alarm visual state.


## Unified Shell panel and component design, 2026-09-24

Executed on macOS arm64, Bun 1.4.2, after replacing the independent diagram dock
and alarm drawer with one persistent workbench `ShellPanel`:

- `bun run check`: both TypeScript versions and architecture boundaries passed
  (59 modules).
- `bun test tests`: 85 passed, 2 PostgreSQL cases skipped, 0 failed. The existing
  OpenTUI test emitted React act warnings and passed.
- `bun run test:browser`: passed actual dev startup, 2D Firmverse RGB565 display
  and four navigation buttons, TS live hints/JSDoc, source drag, runtime commands
  and alarm acknowledgement, report coverage, history, Git, palette, WebGL
  rendering and desktop/tablet/mobile/HMI viewport checks. The live-hint assertion
  accepts locale thousands separators in 1450 rpm.
- `bun scripts/interaction-test.ts`: passed 2D/3D multiselect trends, equipment
  movement and persisted cable rewire/unplug/reconnect; no page errors.
- `bun scripts/shell-audit.ts`: passed eight surfaces, sidebar controls, mobile
  navigation/zoom/actions; 19 captures at 1440×960, 1024×768 and 390×844, light and
  dark. Page dimensions stayed within 390×844; no page errors. Checked, published
  and applied matched, semantic diff was empty.
- `bun scripts/shell-panel-test.ts`: passed single-container invariant across
  surfaces and repeated notification clicks, terminal input preservation,
  keyboard tabs and separator, mouse resize, expand/restore/collapse, actual
  simulator alarm and persisted acknowledgement, failed acknowledgement/retry,
  inspector bounds, command palette, mobile, broken draft retaining applied,
  host shutdown/offline and stale readings. HTTP 503 acknowledgement failure is
  intentionally injected; other runtime states come from the fixture host.
  No page errors. Browser recording: `artifacts/shell-panel.webm`; inspected frames:
  `artifacts/shell-panel-{notifications-light,notifications-dark,alarm,ack-failed,
  acknowledged,collapsed,inspector,palette,phone,build-error,offline,stale-readings}.png`.
- `git diff --check`: passed.

Screenshots and recordings are local artifacts, not committed assets. These runs
verify the fixture simulator and SQLite, not physical equipment or PostgreSQL.
They do not close the independent capability gaps documented above.


## Consistent clicks, selection and syntax themes, 2026-09-24

Executed on macOS arm64 / Bun 1.4.2:

- `bun run check`: both typechecks and architecture boundaries passed (59 modules).
- `bun test tests`: 87 passed, 2 PostgreSQL cases skipped, 0 failed. Existing
  OpenTUI React act warnings remain. Two new model cases cover stable resource
  navigation and closing active/inactive tabs.
- `bun run test:browser`: passed actual dev, Firmverse WASM display/buttons,
  source hints/JSDoc/drag, runtime commands/ack, reports/history/Git, explicit
  source/diagram navigation, WebGL and responsive viewport checks.
- `bun scripts/interaction-test.ts`: passed 2D/3D multiselect, equipment drag,
  cable rewire/unplug/reconnect, with no page errors.
- `bun scripts/shell-navigation-test.ts`: passed clicks across resource rows and
  tabs, stable tab order, retained source draft, synchronized equipment panel,
  source split versus explicit diagram navigation, text selection gestures on
  chrome and editor, live theme switching, and 390px actions menu without page
  overflow. No page errors. Real computed CodeMirror keyword color matched its
  semantic token. All nine syntax colors have contrast >=4.94:1 in light and
  >=5.75:1 in dark against their editor background; this is a scoped palette
  check, not a claim of full application WCAG conformance.

Inspected local frames: `artifacts/shell-navigation-source-{light,dark}.png`,
`artifacts/shell-navigation-diagram-{light,dark}.png`,
`artifacts/shell-navigation-phone-actions.png`. UI selection is disabled for
buttons/navigation/canvas while source, inputs, documents, reports and logs
retain copying. Tests use a disposable project and simulator/SQLite.


## Explicit explorer and independent tabs, 2026-09-24

Executed on macOS arm64 / Bun 1.4.2 after replacing the contextual sidebar with
one resource tree and removing the diagram/source split:

- `bun run check`: passed both typechecks and architecture boundaries (60 modules).
- `bun test tests`: 88 passed, 2 PostgreSQL tests skipped, 0 failed. The existing
  OpenTUI act warnings remain. Updated navigation acceptance requires independent
  project diagram/source-path tabs, dirty-source close protection and an empty
  workbench after closing the last tab. The new tree test checks actual nested
  paths, multiple declarations in one file and missing source locations.
- `bun run test:browser`: passed actual dev startup, Firmverse WASM screen/buttons,
  source hints/JSDoc, authored 2D drag, runtime commands/alarms, reports/history,
  Git, palette, WebGL and responsive checks. Source and diagram are exercised as
  separate tabs; the old simultaneous split assertion was removed as requested.
- `bun scripts/interaction-test.ts`: passed 2D/3D multi-selection, equipment drag,
  cable rewire/unplug/reconnect, with no page errors.
- `bun scripts/shell-navigation-test.ts`: passed real directory nodes, keyboard
  expansion, filtered nested paths, explicit device actions, one diagram tab,
  independent source tabs, stable order, Ctrl+Tab, retained draft, guarded source
  close, unguarded view close, all eight surfaces, selection, mobile overflow,
  closing all tabs and explicit reopen. No page errors.
- `bun scripts/shell-audit.ts`: passed all eight surfaces, 19 captures in light/dark
  and desktop/tablet/390px layouts; no page errors or 390px document overflow.
  Checked/published/applied matched and semantic diff was empty.
- `git diff --check -- src/shell scripts tests docs`: passed.

Inspected local frames: `artifacts/explorer-{diagram-light,source-light,
source-dark,nested-source,diagram-dark,phone-tree,phone-source,empty}.png`.
Recording: `artifacts/explorer-tabs.webm`. The explorer uses the existing indexed
workspace source catalog (.ts/.tsx/.md/.json); binary/hidden files and node_modules
are outside that existing editor contract. Simulator/SQLite checks do not verify
physical equipment or PostgreSQL.

## Shared context menus and neutral themes, 2026-09-24

Executed on macOS arm64 / Bun 1.4.2, using disposable fixture projects and
Chromium with simulator/SQLite:

- `bun run check`: both TypeScript checks and architecture boundaries passed
  (61 modules).
- `bun test tests/shell-model.test.ts tests/resource-tree.test.ts`: 13 passed,
  0 failed. The full unit suite was not rerun for this iteration.
- `bun scripts/shell-menu-test.ts`: passed clicked-row targeting without implicit
  navigation, actual clipboard path, Shift+F10, Home/End/Enter/Escape and focus
  restoration, shared project/view/panel dropdowns, outside dismissal, bounded
  TypeScript language-service hover with multiple actual token colors in both
  themes, separator keyboard focus, preflight dirty guard for batch close,
  explicit close-saved behavior, mobile and viewport bounds. No page errors.
- `bun scripts/shell-navigation-test.ts`: passed source tree, independent tabs,
  preserved drafts, close guards, keyboard and mobile navigation; no page errors.
- `bun scripts/shell-panel-test.ts`: passed persistent panel, keyboard, resize,
  expand/collapse, retained terminal draft/log, runtime alarm and ack/retry,
  inspector bounds, themes/mobile, failed build retaining applied, offline/stale.
  No page errors; acknowledgement failure is intentionally injected by this test.
- `bun scripts/shell-audit.ts`: passed all eight surfaces, 19 captures including
  2D/3D, light/dark, desktop/tablet/390px. No page errors or mobile overflow;
  checked/published/applied matched and semantic diff was empty. The mobile
  action locator now targets the shared menu's checkbox item explicitly.
- `git diff --check -- src/shell scripts docs`: passed.

Inspected `artifacts/shell-menu-{file-light,hover-dark,hover-light,panel-dark,
phone-view}.png`; other captures include project, tabs and phone context menus.
Recording: `artifacts/shell-menus.webm`. This is browser/simulator verification,
not physical equipment or PostgreSQL verification.

## External projects, authoring and cloud separation, 2026-09-24

Executed on macOS arm64, Bun 1.4.2:
- `bun run check`: both TypeScript checks and architecture guard passed (72 modules).
- `bun test tests`: 91 passed, 2 PostgreSQL cases skipped, 0 failed. The existing
  OpenTUI act warnings remain. The server coordinate regression now matches an
  explicit x property with negative literals, avoiding the unrelated `max` key.
- `bun scripts/browser-test.ts`: passed with the external example fixture,
  explicit project browser entry, real Firmverse RGB565 display/navigation,
  2D drag, commands/alarms/reports, source navigation, WebGL and responsive HMI.
- `bun scripts/authoring-browser-test.ts`: passed persisted sidebar width,
  consecutive equipment gestures during an injected 900ms save delay, stable
  optimistic position after both responses, template device source creation and
  named HMI source creation. No browser page errors. Recording is under
  `artifacts/authoring-video`; capture `artifacts/authoring-hmi.png`.

These checks cover the local simulator, browser and SQLite. They do not verify
physical PLC flashing or a hosted persistent runtime. SaaS verification is owned
by the separate SaaS repository.

## Main protocol integration into the repository split, 2026-09-24

Merged `origin/main` at `fe3f84888cee37779b578f0f5ed34873e71b519a`
into `codex/repository-boundaries-and-authoring`. Both deployment and protocol
exports, external fixture aliases, and the bounded CI protocol test command
were retained when resolving the three merge conflicts.

Executed on macOS arm64 / Bun 1.4.2:
- `bun install --frozen-lockfile`: passed.
- `bun run check`: both TypeScript checks and architecture guard passed
  (74 modules).
- `bun test tests`: 124 passed, 3 skipped, 0 failed, 127 tests across 29 files.
  PostgreSQL was not configured (two skips); the RTU PTY case requires Linux.
  Modbus TCP, MQTT and secured OPC UA used real local network fixtures; the
  compiled Modbus driver also delivered observations to Runtime and SQLite.
- `git diff --check`: passed.

The first run exposed a scoped IPv6 reverse-DNS failure in the OPC UA SDK on
Bun/macOS. The local server fixture now temporarily requests IPv4-first DNS
and restores the previous setting. This does not claim to fix the SDK's
scoped IPv6 handling in production. The scaffold acceptance now allows the
external project's dependency installer while continuing to reject IDE source
and IDE infrastructure. Existing OpenTUI act warnings remain.

This is merge and runtime integration evidence, not physical PLC flashing,
remote deployment, or a new browser/GPU acceptance run. The protocol source
kits imported from main still reside at `project/plugins` and need migration
to the external plugins repository before completing the repository split.

## Portable runtime release and external protocols, 2026-09-24

On macOS arm64 / Bun 1.4.2, `bun run check` passed both TypeScript checks
and 75 architecture modules; `bun test tests` passed 125 tests, with 3 skips
(PostgreSQL twice, Linux-only RTU PTY) and no failures. Protocol implementations
were moved unchanged to saturn-plugins `5822474`; their existing wire/SQLite tests
now use the external checkout.

The new runtime acceptance test builds an actual external project and host bundle,
deletes authored source, starts a separate Bun process, checks read/control/deploy
permissions and lock mismatch rejection, deploys through the HTTP CAS path, observes
continued simulator readings while another process spins its CPU, and restarts
the runtime to verify the applied identity and SQLite history are retained.
It does not simulate hardware flashing or claim a fault-tolerant cluster.
No renderer was changed; no new browser/GPU parity claim is made by this test.

The external protocol catalog revision is pinned in IDE CI so later kit changes
cannot silently alter the acceptance input. No vendor-specific module is
imported by the production runtime host.

After the example acquired release scripts, source tooling was updated to resolve
public subpaths from the IDE's package exports instead of a separate handwritten
map. Repeated `bun run check` and all 125 local tests passed (same 3 skips).
`bun scripts/browser-test.ts` passed the actual external project, Firmverse WASM
screen/buttons, source hints, device drag, commands/alarms/reports/Git, WebGL and
responsive HMI checks. The fixture excludes generated .saturn deployment output.

## 2026-09-24 — operator gateway prerequisites

Runtime control requests now require expectedApplied, checked inside the same serialized
queue as publish/apply. The standalone-host integration test covers rejection of a stale
identity and acceptance of the current one. Shared Scene/Control projections are exported
through `saturn-ide/surfaces`; this adds no alternative project model or runtime authority.
Verification results are recorded after execution below.

Executed on macOS arm64 / Bun 1.4.2: `bun run check` passed both TypeScript compilers
and the 76-module architecture guard; `bun test tests/runtime-host.test.ts` passed
1 test / 20 assertions, including command/apply revision fencing.

## 2026-09-24 — Firmverse, Workflow scenarios and SaaS operator

External project: `saturn-examples/firmverse-station`; infrastructure and authorization:
`saturn-saas`. No SaaS dependency introduced into IDE or core.

Executed on macOS arm64, Bun 1.4.2:
- Example strict TypeScript and 2 emulator tests / 14 assertions passed.
- Firmware application compiled by pinned Firmverse WASM: 208 bytes,
  SHA256 `4f22296f0ad1bd8fd70e01e60181e03d604736a4c65c2bfeaa27221b68ad6650`.
- Actual Nitro-compiled Workflow SDK run `wrun_01M3A8EA2CF8JZXVJYD2BFHMV7`
  completed against separate Firmverse process via runtime commands: rpm 0→1450,
  flow 12 m³/h at opening 50%; readbacks include advancing sequence/sourceAt.
- Checked portable runtime applied as `ff348352f7a5fafbb9f190732708c414f96bbb7bfa2cb112164c6df4185e123c`.
- Real browser: local IDE's `firmverse-wasm-rgb565` display, page 0→1 via physical
  button hit area, WebGL 3D canvas, artifacts/firmverse-live-{2d,3d}.png.
- SaaS browser: real GitHub API authorization, shared Scene/Control, actual runtime
  stop/start observed from WASM. Dark/light/390px screenshots + recording under artifacts/.
  Offline controls and concurrent source version were specifically response-injected in
  Playwright; local draft survives incoming version and explicit reload updates CodeMirror.
- Authenticated HTTPS tunnel reads actual runtime; unauthenticated state returns 401,
  source/deployment paths return 404. Cloud operator requires GitHub OAuth login.

No physical MCU flashing, cloud vendor LCD factory distribution, CRDT cursors or durable
per-user command audit is claimed. The temporary tunnel and simulator are a local demo;
production reliability of hardware deployment remains an outstanding acceptance criterion.
