# Infrastructure and performance

The Performance surface is a read-only view of the current applied Project. It
uses the same Signal, Sample, signalHealth and historian as process equipment.
No infrastructure project format, metric registry, automatic plugin activation,
OS command channel or replacement time-series database was added.

## Try the real example

Check out matching `saturn-ide`, `saturn-plugins` and `saturn-examples` revisions
as siblings. From the IDE directory, after `bun install --frozen-lockfile`:

```sh
SATURN_PROJECT=../saturn-examples/infrastructure bun dev
```

Open Deployment, publish the checked revision and apply it. Saving the source
alone never starts live collection, even though this collector is read-only.
Open **Performance** in the explorer or command palette. The dependency-free
example uses the IDE's installed, locked toolchain (Builder's existing lock
fallback). Its copied plugin imports only the public Saturn API and Node APIs.
A portable runtime release still requires the matching runtime/core/lock.

The layout follows Task Manager's resource rail, mini charts, large selected
graph and statistics. A separate Runtime & sources tab has the current process
PID/uptime and a sortable acquisition-source table. It does **not** enumerate
arbitrary OS processes, Docker containers, GPU engines or network adapters.
There are no terminate/restart actions. Existing production controls are unchanged.

Search by signal label, owner, ID or unit; use arrows/Home/End in the resource
rail. Top tabs support keyboard navigation. Inspect signal opens the existing
signal view. System/light/dark themes share shell tokens; narrow screens use a
horizontal resource rail and an internally scrollable source table.

Pause freezes only the display, including the measurement clock and selected
history; acquisition and archival continue. Selecting an uncached history while
paused shows an explicit empty state. Screen refresh (1/2/5 seconds) never changes
the driver's sampling interval. Changing project/applied revision discards the
view cache. Missing, invalid, disconnected and stale measurements never show a
fabricated zero/current value.

## Owned contracts

- `core/diagnostics.ts`: read-only SourceStatus, RuntimeStatistics and
  RuntimeDiagnostics projections. Driver.status is optional. Protocol connect
  receives an optional diagnostic reader through its third context argument.
- `runtime/acquisition.ts`: existing source workers, timings and bounded command
  queue. It projects active channel counts/queued writes and last complete read
  duration; subscription sources have no invented read latency.
- `runtime/engine.ts`: observation backlog, committed sample/batch counters,
  persistence failures, most recent write duration/time. Inspection performs no
  SQL and generates no observations. Failed transactions never count as committed
  samples or mutate the authoritative snapshot. Error category omits SQL secrets.
- `protocols/system-metrics.ts` in saturn-plugins: lazy, read-only OS/process
  acquisition. Project extensions remain outside IDE production code.
- `core/history.ts`, Store.range and `host/history-api.ts`: shared bounded numeric
  range query; both dev and standalone runtime expose the same route.
- `shell/performance.tsx`: presentation only, reusable through the surfaces export
  and explicit history/diagnostic reader props. No runtime import in the shell.

`GET /api/diagnostics` is available independently of historian reads. The
standalone host requires the existing runtime token and rejects browser Origin
requests; use the authenticated gateway. The local dev host retains its existing
loopback/origin boundary. Diagnosis neither grants control rights nor publishes
an artifact. There is no public database-backed health dependency added.

## Measurement semantics

OS CPU is the busy/total difference of cumulative CPU times across the reported
logical CPUs. First reading, counter reset and changed CPU count are unknown.
Process CPU is the change in user+system CPU time divided by elapsed monotonic
time and OS logical CPU count; 100% means total reported host capacity, not one
core. Neither statistic claims a cgroup CPU quota.

OS memory is `totalmem - freemem` and may include filesystem cache; this is not
Linux MemAvailable, a container memory limit or an exact clone of Windows memory
accounting. Process memory is RSS. Disk usage uses statfs blocks/bfree; available
bytes use bavail. Unsupported/inaccessible filesystems make only those channels
bad. Event-loop delay is excess delay of a 20ms timer, not a percentile or CPU
utilization. Runtime counters reset when that runtime process starts; acquisition
counters reset when its driver starts. None is a lifetime fleet statistic.

The collector polls only in its runtime session. SDK/OS imports and reads are
lazy; build/import cannot inspect the running host. Awaited batches use existing
acquisition backpressure. The collector does not recursively instrument its own
inspection. If archive persistence stalls/fails, the independent diagnostic API
can still expose the engine's counters, but the collector's stored signal values
may stop updating. It is not a disk-backed offline spool or out-of-process watchdog.

## History contract

```
GET /api/history/range?signal=EDGE-01.cpu&from=<epoch-ms>&to=<epoch-ms>&points=300
```

Interval is [from,to), at most 31 days, 1–1200 bins. Input is validated before
SQL; numeric signals only. The range uses stable semantic identity and indexed
server **event** time, not the device source clock. SQL reduces all matching rows
before sending a bounded response, rather than truncating to the latest 300.
Each bin contains count, good count, min/max and its final usable value. Bad,
missing, wrong-typed or expired observations cannot become numeric zero. Peaks
outside engineering limits survive. Empty bins have nulls; bins with quality
transitions break the line, while min/max strokes retain measured peaks.

This is a visualization envelope, not a replacement for raw reporting evidence:
a bin count is not uptime/coverage, a coarse bin cannot locate a sub-bin outage,
and percentiles/histograms cannot be reconstructed from min/max. Existing legacy
history and report paths remain available. Range queries do not change retention
or create data before collection started. The current default archive pruning
remains seven days. Preview rails keep at most 120 observations for each of the
first 128 numeric signals; missing previews do not imply missing archive data.

## Verification and limits

`bun test tests/infrastructure.test.ts` covers real SQLite aggregation beyond the
old point cap, gaps/quality/timestamps/identity, failed persistence, counter/CPU
math, a real local OS source and pure view projections. Runtime-host acceptance
checks the authenticated range/diagnostic endpoints in the separate runtime
process. `bun scripts/infrastructure-browser-test.ts` builds the external example,
explicitly publishes/applies it and uses real collected values in the actual
shell. It checks keyboard/search/pause/sort/ranges, independent diagnostic reads
on a test-injected history failure, themes and a 390px layout. Screenshots and a
machine-readable receipt are retained as CI artifacts.

A browser test source is not evidence of a successful run; consult the actual CI
receipt. Linux verification does not establish Windows/macOS statfs or native
host acceptance. Arbitrary process enumeration, Prometheus/OTLP adapters,
container limits, histogram/percentile storage, distributed watchdogs and
lower/discrete/delayed alarm conditions are not implemented by this slice.
