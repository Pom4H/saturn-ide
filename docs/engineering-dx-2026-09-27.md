# Engineering authoring DX — 2026-09-27

This is a narrow, verified authoring slice, not a claim of old Saturn feature parity.
The reference was the clean `HEAD` snapshot of `saturn-examples/pumping-station`, not its
locally modified working tree. Its `project.ts` explicitly imports reservoir, booster,
valve, project-owned PLC and report definitions; it connects their typed fluid/control
ports and derives HMI from topology. `server.ts` explicitly imports the simulator, while
`browser.ts` supplies the project-owned PLC display factory. The new empty starter has
neither entry, so a successful check does not invent observations or start a driver.

## One-day friction audit

| Priority | Observed friction | Concrete disposition |
| --- | --- | --- |
| 1 | **Add equipment** exposed only `tank`, `pump`, `valve`, `plc` from `src/workspace/scaffold.ts`. An engineer could hand-author `device()`, as the PLC source kit does, but could not start that path from the IDE. | Added **Project-owned equipment** to the existing template API/dialog. Its preview creates one ordinary TypeScript definition and an explicit `project.ts` import. The definition has an editable SVG placeholder, and no invented physical ports or measurements. The engineer adds `terminal()`/`signal()` after verifying the actual device. |
| 2 | The generic 3D fallback showed decorative terminal blocks even when a project-owned definition declared `ports: {}`. This made a new, unwired device look physically connected. | `src/shell/scene3d.tsx` omits those blocks only for equipment without declared ports. The existing tank/pump/valve geometry, project-owned PLC panel and actual port meshes remain on their existing paths. This is still a generic 3D volume, not a device-specific model. |
| 3 | A domain check error from `project()`/`validateProject` became one generic `PROJECT` problem in `src/host/dev.ts:106`. `Builder` preserved TypeScript diagnostic ranges, but a thrown `ProjectError` from evaluating the bundled model lost its domain code/localized text/source range before reaching Shell. | Fixed through the existing `Problem` contract. `workspace/build` recognizes the bundled error structurally, keeps its code and EN/RU messages, and finds a range only for an unambiguous authored call. CodeMirror shows that range alongside TypeScript diagnostics while its text matches saved source; Review and notifications show the same code/path. An invalid save retains the previous Checked and Applied identities. |

On a 390 px viewport, the longer project-owned source preview also pushed the Create
button below the initially visible modal area. The source preview now has its own bounded
scroll area. The button is visible without scrolling the dialog; source text remains
selectable and keyboard focus reaches Create from Cancel.

## Implementation and checks

- `src/workspace/scaffold.ts`: fifth template generates `device()` in
  `equipment/<ID>.device.ts`, a stable project-owned kind, a visible 2D placeholder,
  and ordinary explicit import. Example `terminal()` and `signal()` lines are commented
  out until the engineer confirms the actual physical contract.
- `tests/project-authoring.test.ts`: a fresh project checks the generated definition,
  indexes its real source range and supports two-way position editing. The test then
  authors a digital sink and writable boolean signal, connects it to a PLC DO1 through
  the normal `cable()` contract and checks the resulting project with `Builder`.
- `src/shell/scene3d.tsx`, `src/shell/resources.css`: the narrow fallback and modal
  corrections above. `docs/quickstart.md` describes how to continue editing the class.
- `src/workspace/project-diagnostics.ts`, `src/workspace/build.ts`: bundled `ProjectError`
  has a distinct JavaScript constructor, so `instanceof` is insufficient. These modules
  keep its existing code and localized messages and locate clear `POSITION` and connection
  errors through the shared structural AST form. Ambiguous/computed source keeps the
  diagnostic without a guessed range. `src/shell/editor.tsx` and `src/shell/app.tsx`
  merge domain markers with TypeScript diagnostics only against the saved source.
- `scripts/project-owned-device-browser-test.ts`: actual local Bun host and Chromium,
  empty project → template preview → persisted source/import → Checked build → 2D SVG
  → 3D generic projection. It checks `Applied` is still null, no browser page errors,
  390 px horizontal bounds, visible modal footer, selectable code and Tab focus.

Executed on macOS arm64, Bun 1.4.2 and local Playwright Chromium:

- `bun run check`: **PASS**, both TypeScript compilers and architecture guard (150 modules).
- `bun test tests/project-authoring.test.ts`: **4 pass, 0 fail, 18 assertions**.
- `bun test tests/project-diagnostics.test.ts tests/project-authoring.test.ts`:
  **5 pass, 0 fail, 37 assertions**. The real host saved an invalid equipment position
  and then an incompatible cable quantity; both kept code, EN/RU, file/range and the
  prior Checked hash, with no Applied build.
- `bun scripts/project-owned-device-browser-test.ts`: **PASS**. Inspected
  `artifacts/project-owned-device-2d.png`, `project-owned-device-3d.png` and
  `project-owned-device-phone-preview.png`; recording in
  `artifacts/project-owned-device-recording/`.
- `bun scripts/project-diagnostics-browser-test.ts`: **PASS**. After a real host save
  of `x: 15001`, Chromium showed the domain underline on that number and `POSITION`
  with RU text/path in Review. Checked retained its previous hash; Applied remained
  empty. A subsequent unsaved syntax error cleared the stale domain underline while
  TypeScript lint remained active. Inspected `artifacts/project-diagnostics-source.png` and
  `project-diagnostics-review.png`; recording in `artifacts/project-diagnostics-recording/`.
- `SATURN_EXAMPLE=<clean HEAD pumping-station snapshot> SATURN_CAPTURE_ARTIFACTS=1 bun scripts/browser-test.ts`:
  **12/12 checks PASS**. Inspected `artifacts/ide-3d.png`: the project-owned PLC panel
  and its real ports still render beside the existing pump/tank/valve geometry.
- An independent generated starter with this custom equipment ran `bun install` using
  the documented temporary Git HTTPS rewrite and then `bun run check`: **PASS**.
  This machine had GitHub credentials; dependency access on another machine was not tested.
- `git diff --check`: **PASS**. Temporary example/install fixtures and test hosts were closed.

The generated class is a starting point. It does not define a physical pinout, simulator,
protocol driver, HMI target, firmware or accurate 3D model. Real 2D/3D fidelity and hardware
acceptance remain owned by the equipment project/source kit and the corresponding open
criteria in `docs/capabilities.md`.
