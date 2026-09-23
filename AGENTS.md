# Saturn IDE — MVP constraints

The application is an engineering IDE, not a landing page.

- Keep the project model in TypeScript files. Git is history; SQL is observations/events/subscriptions. Do not add a parallel project JSON, metadata database, registry or proprietary language.
- Use the TypeScript compiler and language service. Never build a second type system or a manually maintained completion/JSDoc dictionary.
- Plugins are copied source files and normal imports. Keep device.ts, hmi.ts, compiler.ts and firmware sources next to their equipment. Do not add package discovery, manifests, dependency injection, runtime plugin registration or a marketplace.
- bun dev starts one local Bun process with the actual frontend, SCADA, SSE, Git, push and chosen SQL adapter. Do not add orchestration merely to start the MVP.
- Preserve the original SVG anatomy/ports and use one renderer for engineer/operator/HMI. Never replace real screenshots with illustrations. System theme is the default.
- A command is not telemetry. Unknown/stale values must not look healthy. Layout changes must not restart acquisition. Keep last-good model on source errors and prevent lost file updates.
- Do not invent firmware or claim physical-device support from a scaffold. No flashing automatically. Local projects are trusted code; do not expose this MVP as a public multi-user server.
- Test the source round trip, comments, conflicting writes, early pipe movement, true JSDoc, storage adapters and real browser UI. One CI job is enough. Do not force-push main.
