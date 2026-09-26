# ADR-0002 — Resource-oriented, isomorphic Shell

Status: accepted; the implemented host subset and remaining acceptance criteria are explicit below.
Date: 2026-09-23. Extends ADR-0001; does not replace its runtime/build isolation commitments.

## Decision

The unit of navigation is a **project resource**, not a tab-specific copy of an engineering object.
A device has a stable URI based on its project and domain ID, a class icon, an instance name,
an actual source location, relationships and supported editors. The same resource may open as
Diagram, Source or Signals. A report opens as its result or Source. A plugin is an ordinary
source file or source-owned folder, not an installed application extension.

The resource catalog is a disposable index of the existing Project and working source AST.
It is not a second authored model, not another registry and not a database of installed plugins.
GET /api/resources reads files; it never imports/evaluates those files to discover their UI.
Opening an object does not compile firmware, start a driver, publish or apply a release.

The catalog's revision identifies the applied model used for indexing. Its source locations
refer to working files. They are NOT proof that the current source is checked/applied. Draft
and runtime remain separate; the full checked-draft browser is still an open capability.
Ambiguous declarations do not receive an invented source range.

## Shared model, separate renderers

```
TS project / working source                         runtime authority
              |                                           |
    workspace/resource-index                       HTTP / SSE
              +--------------------+----------------------+
                                   |
                     ShellClient + ShellSession
                     Documents / open / save / close
                                   |
                      +------------+------------+
                      |                         |
                 React DOM                  React OpenTUI
                 CSS / SVG / Three          text / TTY layout
```

Shared: resource identity, search, editor capability selection, navigation, source buffers,
optimistic file versions and commands. React's binding uses useSyncExternalStore for both.
The model itself imports no React, Bun, DOM, terminal library, filesystem or runtime module.
The dependency guard enforces this boundary.

Not shared: DOM nodes, CSS layout, graphical SVG/3D, terminal cells and renderer lifecycles.
An unsupported renderer is rejected, not replaced with a misleading screenshot or fabricated
HMI. Terminal Diagram is a textual projection of the same physical connections, not a new
engineering model. Graphical HMI stays a browser/target-specific editor.

## Ownership

- core/resources.ts — UI-neutral metadata contract; no new Project/Signal/Topology.
- workspace/resource-index.ts — static source locations and derived resource relationships.
- shell/model/documents.ts — one buffer per real source path, conflict-safe writes.
- shell/model/session.ts — resource tabs, host capabilities and navigation commands.
- shell/model/sse.ts — chunk-safe transport framing, without a DOM EventSource dependency.
- shell/client.ts — the same Fetch client and reconnect snapshots for both hosts.
- shell/use-shell.ts — shared React subscription/connection binding.
- shell/app.tsx, resource-explorer.tsx, icons.tsx — DOM host and resource views.
- shell/terminal.tsx — React/OpenTUI presentation; host/terminal.ts owns the TTY lifecycle.
- shell/svg-motion.ts — browser-only measured animation, never runtime authority.

A browser/terminal session has its own navigation but observes the same server. Concurrent
source edits use the same expected file version; neither host can overwrite a changed file.
Unsaved edits remain after changing editor/resource. A save response cannot overwrite typing
that happened while the request was pending. Dirty tabs cannot silently close. These buffers
are in-memory: crash recovery across process/browser exit is not yet implemented.

## File ergonomics

```
project/
  project.ts                         # composition, not the IDE implementation
  signals.ts
  equipment/P-01.device.ts            # class pump, name «Повысительный насос»
  equipment/TK-01.device.ts
  equipment/V-01.device.ts
  equipment/PLC-01.device.ts
  reports/hourly-water.report.ts
  plugins/simulation.ts
```

These are normal TypeScript modules. The suffix helps humans; class/name come from the real
model, not a guessed filename. The demo is split without changing its equipment IDs, positions,
ports, connections, signals or report calculation. Legacy multi-object files remain supported:
one real file can own several resource entries, all sharing one text buffer.

For a complex PLC, equipment/<id>/device.ts owns hmi.ts, compiler.ts and other source members.
A copied plugins/<name>/index.ts can own its helper files. Cataloging is not activation.
Unrecognized files remain visible as files. New unapplied objects are not invented as live devices.

Icons are semantic IDs, mapped to @mdi/js paths in DOM and ASCII class labels in TTY. The
navigation icon is not the detailed process SVG and never replaces it. State indicators remain
separate from class identity; no required private-use font or emoji width assumptions.

## Implemented host subset

Browser retains the existing graphical surfaces and runtime protocols,
with resource tree/tabs/search/Open as and shared documents. Diagnostics and runtime
commands use the existing APIs and revisions, not file-side effects.

`bun dev` starts the existing workspace/runtime host and browser UI. `bun tui [url]` attaches
a real React/OpenTUI UI to it; `bun shell:list [url]` prints resources without needing a TTY.
The terminal supports resource search, source editing/saving, textual connections/signals,
SQL report output and Git status/diff. F7 now opens the shared command console with control/ack, topology, source
draft insertion with genuine TypeScript completion, and the composing host AI adapter.
Deploy, firmware, full terminal-editor IntelliSense and every browser workflow are not complete.
The same command engine is used by the browser panel and `bun cli`; see [command-shell](../command-shell.md). Exiting the attached TUI does not stop dev.
The dev server itself still shares a process with runtime; ADR-0001's isolation work is NOT closed.

## Acceptance and next extensions

The same document/save command must pass in both host sessions. Browser tests cover icon/name
consistency, resource identity through Open as, true AST drag, JSDoc, measured SVG phase,
reduced motion, actual SQL reports and actual Three frames. A real OpenTUI renderer test is
included, not a handcrafted terminal screenshot. Executed vs unexecuted tests are recorded
in docs/verification-shell.md.

Remaining: arbitrary project-owned device definitions/renderers, derived/dimension typing,
Presentation/PLC targets, report jobs/XLSX/replay and independent runtime from capabilities.md
remain obligations. Future rename/delete/move operations need reference-aware edits, file-CAS,
impact preview and explicit live apply. They are not implemented by relabeling a resource.
Do not grow a generic plugin manager, virtual filesystem framework or per-surface domain store.
