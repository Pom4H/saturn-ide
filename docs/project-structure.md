# Project structure and readable source history

## A small starting point

`bun run scaffold project ../new-station` creates an empty authored project.
The installed/source launcher also exposes `saturn init ../new-station` /
`bun start init ../new-station`. Complete examples are external project source;
pass `--template pumping-station --example ../saturn-examples/pumping-station`
(or set `SATURN_EXAMPLE`). The default has five files:

```
new-station/
  project.ts       # the single authored model
  package.json     # dependency and external check command
  tsconfig.json    # ordinary TypeScript settings
  README.md        # project instructions
  .gitignore
```

The IDE opens it using `saturn gui --project ../new-station`. The empty diagram
provides Add equipment, including source preview and checked explicit import.
A simple device adds one source file in `equipment/`. Reports, HMI, targets,
project tests, custom views and firmware get folders when the project needs them.
Existing projects are not moved or rewritten.

For a project-owned PLC or plugin skeleton from the IDE checkout, pass the destination
explicitly: `bun run scaffold plc plc-01 --project ../new-station` or
`bun run scaffold plugin sensor --project ../new-station`. The generated source is not
registered globally or added to `project.ts`; import the definitions you choose to use.

`server.ts` is optional and selects a driver through normal exports. `browser.ts`
is optional and supplies custom browser displays. Their use in the station example
is intentional; a new project does not need copies of these files. The host,
compiler, shell and runtime implementation remain part of Saturn IDE.

The IDE checks the starter without project-local `node_modules`. For standalone
TypeScript tooling, `bun install` resolves the declared core Git dependency over
SSH; configure repository access first, then commit the generated `bun.lock`.
The starter does not invent a lockfile or claim that external dependencies were
installed. See [First project](quickstart.md) for the checked and runtime states.

## Preserve the full example

The previous complete station remains explicitly available:

```sh
bun run scaffold project ../station-demo --template pumping-station --example ../saturn-examples/pumping-station
```

The example checkout may live anywhere. Pass it explicitly with `--example` or
`SATURN_EXAMPLE`; Saturn IDE does not infer a sibling repository. If unavailable,
creation fails before creating the destination.
Vendor SVG/3D, Firmverse HMI/firmware, reports, simulation and project tests are
preserved when copying this template. Install the copied project's dependencies
before opening it: its project-owned React HMI requires React and type declarations.
Its core dependency is pinned by the example, so the user needs repository access.
Firmware remains an explicit real toolchain.

## Explorer views

A single selector controls four projections of the existing resource catalog:

- **Objects** (default): project, equipment, reports, HMI and target resources
  with authored names, domain icons and IDs. Opening a device selects its diagram;
  its context menu offers source and signals.
- **Icons**: the same objects in a compact tile layout, with keyboard navigation.
- **File list**: real files in one flat list, including paths to distinguish equal
  basenames. Shared files retain their individual declarations.
- **Folders**: the actual source hierarchy.

Objects and Icons keep all files under Sources and settings. The preference is
stored in local shell layout, not in project source. No hidden installation DB,
synthetic authoring format or replacement for TypeScript is introduced.

## Git inspection

Selecting a commit shows **first parent → commit**, including root commits.
Working copy inspection uses **HEAD → disk**, including staged and untracked
supported source. The scope remains the project directory in nested repositories.
Restoration has a separate **current HEAD → selected commit** preview and retains
clean-tree/expected-HEAD guards and the new-commit workflow.

AST summaries read source blobs without importing or executing historical code.
Explicit equipment, signals, connections, alarms, reports, HMI and project calls
produce add/remove/change facts and property before/after values. Stable semantic
IDs preserve equipment identity through renames and file moves. Core factory
aliases are recognized. Formatting and comments alone do not create model facts.

This is a partial syntax summary, not a claim about physical effects or evaluated
runtime behavior. Unknown/computed/imported behavior remains inspectable in the
text diff. Preview is bounded to 100k diff characters and 60 changed TS files,
with a visible limit notice. Diff has addition/deletion/hunk colors, line numbers
and TypeScript syntax colors in both themes.

The A/B observation comparison block was removed from the graphs panel at the
user's request. Run provenance and the runtime comparison API remain available;
the UI currently presents ordinary measurement history only.
