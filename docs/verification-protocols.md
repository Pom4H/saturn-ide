# Verification — Modbus, MQTT and OPC UA, 2026-09-24

Implementation commit: `62eb52d117bc46bdb461c5b4bdb85fa979ccf25f`.
Successful workflow: [MVP checks / run 35997037021](https://github.com/Pom4H/saturn-ide/actions/runs/35997037021).
Job: [check / 107624306313](https://github.com/Pom4H/saturn-ide/actions/runs/35997037021/job/107624306313).
This record describes the completed run, not a prediction about subsequent commits.

## Executed on GitHub Actions

Ubuntu 24.04, Bun `1.4.2+744846f84`; installed with `bun install --frozen-lockfile`.
Resolved SDKs in the job log: modbus-serial 8.0.25, mqtt 5.16.0,
node-opcua and node-opcua-client 2.186.1, Aedes 0.51.3.
The RTU child uses the runner's Node executable; its version was not separately recorded.

`bun run check` passed both configured TypeScript checks and the architecture guard
(51 source modules). `bun test tests` passed **111 tests, 0 failed, 2 skipped**,
236 expect calls, 113 tests across 26 files, 22.27 seconds of test execution.
The two skips are existing PostgreSQL storage/report tests: this job has no PostgreSQL service.
The process timeout was not reached and the test process exited normally.

## Verified paths

- Modbus TCP over a real loopback socket: fragmented MBAP replies, adjacent register
  grouping, scaling, coil/register writes, exception responses and reconnect.
- Modbus RTU through a real Linux PTY and the native serialport SDK in a Node child:
  an independent Python CRC fixture answers reads/writes, and shutdown releases the process.
  This is not a physical USB/RS485 adapter or PLC.
- Independent register encoding vectors cover byte/word order and signed/scaled values.
  Additional tests reject real fractional register commands/overflow while allowing
  floating-point arithmetic roundoff, and repeat binding validation after transport.
- MQTT over TCP to a real Aedes MQTT 3.1.1 broker: subscriptions, retained-state staleness,
  malformed payload invalidation, separate command topic and reconnect without acquisition
  resending the earlier command. No command is fabricated as a state observation.
- OPC UA against a real node-opcua server: SignAndEncrypt/Basic256Sha256, explicit client
  trust of the server certificate, batch Value reads, sourceTimestamp preservation,
  bad quality for an unknown node, and typed write/readback. Only the disposable test
  server accepts the generated test client automatically; the actual plugin does not
  auto-trust discovered server certificates.
- A separate external-project test builds the copied Modbus plugin without connecting,
  loads the actual retained driver, connects its real SDK, commands/reads a value,
  and verifies it in the actual Runtime and SQLite history. Dependencies are explicitly
  provisioned in that test; no fake SDK or fake SQL store is substituted.
- MQTT/OPC UA reject implicit plaintext configurations and URL credentials before SDK
  initialization. This is a configuration-boundary test, not full security certification.

## Discovered and fixed during verification

Earlier CI runs caught SDK typing/fixture mismatches. Strict checks were kept enabled.
A subsequent actual RTU test crashed Bun on native serialport's `uv_default_loop` call.
Only the serial transport was moved to a bounded Node subprocess: project bindings,
codecs and acquisition ownership remain in the original implementation. The Linux
serial test was retained and passed after the fix. Runtime-only process isolation
from the IDE is a different, still-open acceptance criterion.

## Not verified or not implemented

No physical PLC-500 or other hardware was connected. Windows/macOS serial, electrical
RS485 timing/noise, sustained load/soak testing and deployment on an actual installation
were not performed. MQTT 5, MQTT TLS/WS/WSS, OPC UA username authentication and the other
advertised SDK security policies were not exercised end to end by this run.

The OPC UA plugin currently uses batch polling, not subscriptions; no Browse, arrays,
64-bit integer types, ExtensionObject, HistoryRead or Events support is claimed.
Uncertain StatusCode is conservatively mapped to bad until richer core quality exists.
A permanently silent RTU slave can still disrupt the shared source; per-slave scheduling
is not implemented. No durable offline spool, sample deduplication or new authorization
layer was added. SDK packages/native resources must be provisioned alongside a build;
the JSON artifact alone is not a self-contained deployment package.

Browser/GPU tests were not part of this job. No renderer was modified and no visual
parity or new screenshots are claimed. Full local Bun execution was unavailable;
the execution evidence above is from the actual GitHub Actions job, not local tests.
