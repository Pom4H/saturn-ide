# Checked release and standalone runtime

The engineering workspace creates a `saturn.build@2` artifact. The runtime host
loads only that checked output and the existing runtime modules. It has no
workspace, compiler, Git, source-editing or Shell endpoints.

## Build, provision, apply

From the IDE checkout:

```sh
bun run release:build ../saturn-examples/pumping-station /absolute/path/release
```

The output directory must not exist. It contains `artifact.json`, the compiled
`runtime.mjs`, `start.mjs`, and the project's exact `package.json` and `bun.lock`.
The compiler scratch directory is removed. No authored equipment source or
IDE implementation is copied. The runtime bundle uses Bun; SDKs remain external
so native serial bindings and OPC UA certificate resources keep working.

On the runtime machine, inside that release directory, provision dependencies
with the same Bun version and `bun install --frozen-lockfile`. Private Git
packages require the repository's read-only deployment access. Dependency
installation is an operator/CI provisioning step, never an effect of apply.
Registry/Git dependencies are supported; local file/workspace dependencies are
rejected because they would not be portable.

Set three distinct secrets, each 32–256 URL-safe characters:
`SATURN_READ_TOKEN`, `SATURN_CONTROL_TOKEN`, `SATURN_DEPLOY_TOKEN`.
Then run `bun start.mjs`. Default bind is `127.0.0.1:3100`; `SATURN_HOST` and
`PORT` configure a private interface behind an authenticated HTTPS gateway.
The browser does not receive these secrets. Origin-bearing requests are rejected.
`SATURN_DATA_DIR` defaults to `release/data`. Keep it inside a directory whose
parents resolve the installed SDK node_modules. Preserve this directory across
restarts; it owns the retained artifacts, SQLite history and applied identity.

The runtime starts empty until explicitly published/applied. From the trusted
release client, with only its deploy token in the environment:

```sh
bun run release:deploy /absolute/path/release/artifact.json http://127.0.0.1:3100 null null
```

The final arguments are the **reviewed** expected published and applied hashes
(or `null` for an empty installation). Read `/api/releases` before planning a
subsequent release. The client stages, publishes with CAS, applies with CAS,
and reads the actual durable identity. An ambiguous apply response is reported
with the actual state if reachable; no automatic apply retry is performed.

The host rejects foreign projects, mismatched dependency locks, core hashes or
Bun versions before replacing the working driver. Changing the toolchain or
SDKs requires provisioning a matching runtime, with an explicit maintenance
transition. It cannot hot-update its own dependencies.

## Authority and limits

All protected calls use `Authorization: Bearer <token>`:

- Read: `/api/state`, `/api/releases`, `/api/history?signal=...`, `/api/alarms`,
  `/api/events`. Control and deploy credentials can also read.
- Control only: `/api/command` with `{id,value}`, `/api/ack` with `{id}`.
- Deploy only: `/api/builds` with `{artifact}`, `/api/publish` with
  `{hash,expectedPublished}`, `/api/apply` with `{hash,expectedApplied}`.

Source editing is absent. The immutable artifact still contains executable,
trusted driver code; its hash is not a signature or sandbox. Runtime service
accounts, network permissions and SDK trust configuration remain deployment
responsibilities. This host currently uses SQLite. Report export, Web Push,
per-user auditing and distributed multi-host ownership are not exposed by this
host yet; the local IDE host retains its existing features.

`runtime-owner/` prevents a second host opening the same data directory. Clean
shutdown releases it after the driver stops. After a crash, verify the old
process is dead before removing the marker. Never mount one database under
multiple independent runtime data directories or operate two live owners.
A normal restart restores the applied artifact without reading authored source.
Physical side effects cannot be reversed by restoring a configuration.

Vercel owns the SaaS UI, GitHub integration and durable release orchestration.
Continuous Modbus/MQTT/OPC UA acquisition needs this persistent runtime with
network access to the object. A CI result and SCADA release are not a PLC500
firmware image. Physical flashing still requires the vendor compiler, a verified
memory/register map, transport and hardware acceptance.
