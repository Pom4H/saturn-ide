# Verification — protocol DSL, 2026-09-24

Base: saturn-ide `400b6d20a2505f82ac49d7abeda1e1efb714913b`.

Executed locally with Node 22.16.0 and TypeScript 5.8.3:

- Strict/noUncheckedIndexedAccess compilation of the actual core, artifact, protocol declarations,
  acquisition executor, JSON/HTTP plugin and acquisition tests passed, including negative type assertions.
- The TypeScript implementations were transpiled to CommonJS for Node's test runner. Only public
  import resolution was mapped; no implementation was replaced by a mock.
- `acquisition.test.ts` and `observations.test.ts`: **20 passed, 0 failed**. The HTTP test used an
  actual local HTTP server/socket and fetch. Runtime tests used an explicitly fault-injected
  in-memory persistence adapter, not Bun.SQL or a claimed PLC.

The base core used to establish the local checkout matched Git blob
`570047c87a7e2208cf75bf1face7c1dc911ce0a4` before edits.

Bun is not installed in this container and external git access failed DNS resolution. Full Bun
startup, Bun.SQL/SQLite/PostgreSQL, new integration tests, whole-repository TS6/TS7 and browser
checks were not executed locally. Existing CI workflows are unchanged and run the new tests
alongside the existing suite. An added test is not evidence that CI has passed.

No real PLC-500, Modbus device, OPC UA server or MQTT broker was connected. No firmware, UI
screenshot, full process isolation, durable offline spool or production-readiness claim is made.
