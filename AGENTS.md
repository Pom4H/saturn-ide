# Saturn IDE — architecture contract

Read `docs/architecture.md`, `docs/capabilities.md`, then `docs/verification.md` before changing ownership or claiming a capability is complete.

The task is a better architecture with preserved capabilities, not a smaller product. Old Saturn `90da21a` is an implementation/reference baseline. Never label a missing feature “simplified MVP” and silently remove its acceptance criterion.

- One typed authored TS project → Diagram/HMI/Runtime/History/Reports/PLC/Deployment. A checked BuildArtifact is generated output, not another authoring format. Git/source, checked, published and applied are distinct.
- workspace builds/checks source and owns Git. runtime owns observations/commands/alarms/history/jobs/applied builds, never imports workspace/Shell/compiler. host composes. shell owns Project/Surface/Environment navigation, not runtime authority. Run `bun run architecture:check`.
- Preserve current DSL inference and restore dimensions/derived expressions/project-owned equipment before claiming parity. Four builtin equipment kinds are not the final extension model. No explicit any, fake IntelliSense, alternate Signal/Project/Topology models.
- Copy plugins/equipment/targets into projects; wire through normal imports. No global plugin lifecycle, hidden installation DB, automatic flashing or package per directory. A new project must not contain a copy of IDE implementation.
- Preserve actual SVG/3D code and ports during structural refactors. Never infer visual parity from syntax/type tests. Use real browser recordings and reference frames, including stale/failed/closed states.
- Save is not live apply. Automatic dev preview is simulator-only and can be disabled. On transition, prepare before stopping the old driver, fence callbacks, gate commands and CAS the durable applied identity. Failure after durable commit must report the real new identity. Driver contracts cannot guarantee reversal of physical effects.
- One command may launch multiple failure-isolated parts. Current dev is one process: do not claim runtime independence until the runtime-only host and isolation test exist. Operator mode is not authorization.
- Reports retain missing-data/coverage semantics and must regain old typed schemas/jobs/targets, not become chart-limited queries. No fabricated XLSX or firmware.
- Preserve and extend acceptance tests. Record exactly what ran and on which runtime; test source is not evidence of a passed test. Do not force-push main.
- Before designing CAD/BIM/parametric geometry changes, read `docs/research/cad-competitive-landscape-2026-10-10.md`, `docs/importers.md`, and `docs/spatial-routing.md`. Imported IFC/mesh geometry is not authenticated topology or live equipment; CAD dimensions do not overwrite schematic x/y. Distinguish verified competitor code from vendor claims and roadmap hypotheses.
