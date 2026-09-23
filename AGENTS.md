# Saturn IDE

An engineering IDE, not a landing page. The Shell is a primary product surface, not a demo wrapper.

- One typed TypeScript project drives equipment, physical topology, 2D/3D, HMI, observations and reports. Git is source history; SQL is observations/events/subscriptions. No second JSON project, registry, ORM or proprietary language.
- Preserve inferred signal IDs/value types/writability, concrete equipment ports and report columns. No explicit `any`, parallel type dictionaries or handwritten fake IntelliSense.
- TypeScript 7 is the native checker. Stable AST/Language Service APIs currently use Microsoft's TypeScript 6 compatibility alias. Check both; never blindly replace the API package with a CLI-only release.
- Shell keeps Project, Surface and Environment visible. Contextual canvas tools stay in the canvas. Operator mode must not be confused with authorization. Never invent a published/applied revision for local-only runtime.
- Preserve original SVG anatomy. 2D/3D must consume the same typed endpoints and routed XYZ paths, not independent connection graphs. Pipes carry fluid, cables carry electrical/control/bus connections; crossing paths do not imply connection.
- Commands are not observations. No/stale data cannot look healthy. Phase changes integrate time, not restart on every sample. Layout edits must not restart acquisition. Keep the last-good model and reject conflicting file writes.
- Reports query their actual range, not chart-limited history. Explain integration units and interval convention. Missing is null, not zero; partial aggregates expose coverage. Never silently truncate.
- Plugins are copied files and imports. Device definitions, HMI and firmware compiler belong beside the device. No marketplace, global registration, orchestration framework or automatic flashing.
- One `bun dev` process; one CI job. Tests/screenshot generators must execute the real code. A test being written does not mean it passed. Record available runtime versions and blocked stages honestly.
- Open trusted local code only. No claims of production safety, real hardware support, permissions, deployment or visual parity without corresponding implementation and evidence. Do not force-push main.
