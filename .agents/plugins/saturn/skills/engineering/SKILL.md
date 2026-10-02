---
name: engineering
description: Inspect and edit the connected Saturn TypeScript engineering project; show precise views in its existing UI.
---

Use `saturn_project` to discover the real resources, diagnostics, mode and separate Checked/Published/Applied identities. Use `saturn_open` to show the relevant Diagram, source, HMI, signals, reports, history, deployment or Git view and include its returned link in the answer.

Read normal authored files with `saturn_read_source`; save with their exact versions through `saturn_save_sources`. Never invent another project JSON, fake IntelliSense, global equipment registry, agent harness or chat UI. Project-owned equipment/extensions use normal TypeScript imports. New device creation has a preview and a projectVersion fence. When positioning is omitted, Saturn chooses non-overlapping logical placement. Source authoring and diagrams represent the same project.

Read the project's architecture and verification instructions when available. Review typed declarations and current ports before changing connections. Use the existing authoring preview/language tools for source edits. Keep physical units, dimensions, derived expressions, SVG/3D ports, missing-data/coverage semantics and extension contracts intact.

Save/check is separate from publish/apply. In manual preview, Save never changes Applied. Automatic development preview is simulator-only and follows workspace policy. Use `saturn_publish`, `saturn_apply` and `saturn_command` only for an action authorized by the user and pass current expected identities. Configuration recovery does not reverse physical effects. Operator view is not authorization. Don't call a live action merely to show or inspect a resource.

The app shares its current view URL/selection with the host. Make source changes while retaining the visible projection; don't repeatedly reopen the view on every save. Telemetry belongs to runtime; don't manufacture observations or erase stale/failed states. Report exactly what was tested and distinguish local MCP/Apps acceptance from a real installed ChatGPT tunnel. Don't claim the plugin is published or connected until that step succeeds.
