# Saturn IDE GitHub Pages

The static site is built with `bun run pages:build` into `dist-pages/`. The
`Deploy Saturn IDE GitHub Pages` workflow publishes that directory on pushes to
`main` and on manual runs.

The hero preview uses Saturn's authored `project()`, native `tank` / `pump` /
`valve` equipment, `pipe()` topology, `routeConnections()` and the IDE's actual
Three.js `Scene3D` surface. Its browser-only preview harness maps the four
editable signal initial values (`level`, `rpm`, `run`, `opening`) into simulated
observations; the range controls write those values back to the TypeScript
source editor. The preview does not connect to a server or physical equipment.

The compact demo source lens intentionally accepts the showcased signal
declarations and their bounded literal values. It is not a TypeScript compiler
or arbitrary-project editor. Invalid or out-of-range values leave the last
valid scene visible and show an inline status.

Run `bun test ./tests/pages-demo.test.ts` for model/source synchronization
checks. Run `bun run pages:build` before opening the static output.
