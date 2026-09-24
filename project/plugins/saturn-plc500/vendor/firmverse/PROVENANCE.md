# Pinned portable Saturn toolchain

Source: Pom4H/firmverse, commit `2a960fd1cfa068296cd96d9b0b501c66c36140dd`.
Package: `packages/saturn`. `index.ts`, `binaries.ts`, `manifest.json`, LICENSE
and RUNTIME_LICENSE are byte-for-byte copies; they are not independent forks.

`index.ts` and both embedded WASM assets belong to Firmverse. Compiler source is
shared Rust (`src/controller/saturn_compiler.rs`); execution is the pinned C
`crossrw/fbd-runtime@d09d459c68286fb4f84fa074b0b7a0f27371406d` with the Firmverse
host/state/HMI bridge. Original runtime license is preserved in RUNTIME_LICENSE.
The full rebuild script and behavioral contracts live in Firmverse.

Rust 1.98.1 and WASI SDK 24 were used for these artifacts. Rebuilding at another
source/dependency path can change embedded Rust diagnostics and the compiler
hash. Runtime/program identity must be checked on upgrade; do not reuse opaque
state across a different runtime ABI. `manifest.json` records the exact hashes.
No network fetch or compiler installation occurs during normal SCADA startup.

The older Saturn SVG front panel and target HMI screen encoder remain under
`../saturn`; they are representation adapters, not a second FBD execution engine.
