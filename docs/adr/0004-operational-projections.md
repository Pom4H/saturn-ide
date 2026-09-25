# ADR 0004 — Operational semantics belong to the core

Status: accepted for the implemented signal/quality/alarm/inspection slice.

## Problem

The same `Sample` was interpreted differently by the runtime, browser shell,
editor and reports. The runtime aged measurements by receipt time, the shell
used event time and overwrote bad/offline quality with stale, and reports could
extend coverage after a quality-only event. Alarm-event DTOs were declared
independently in storage and transport. Signal dependencies were already present
in the semantic graph, but HMI consumers were missing.

Adding a commissioning panel with its own copies of these rules would make the
inconsistency a permanent architecture feature.

## Decision

Keep the existing authored `Project`, `Signal`, `Sample`, `AlarmState` and
`BuildArtifact` contracts. Do not introduce a commissioning project, signal
registry, event bus, universal service layer or second authored format.

`core/operational.ts` owns pure interpretation and transition functions:

- `signalHealth` and `projectSnapshot` interpret observations at an explicitly
  supplied time. They never read a clock, touch a driver, mutate the input or
  manufacture a measurement from `initial`.
- `measurementTime` and `sampleInterval` distinguish receipt time, source time
  and the history event timeline. Quality-only events do not renew a measurement.
- `transitionAlarm`, `acknowledgeAlarm` and `alarmNeedsAttention` own the existing
  high-limit/hysteresis lifecycle, including returned-to-normal unacknowledged
  alarms. Reappearance requires acknowledgement again.
- `AlarmEvent` is the single structural event contract. SQL and transport retain
  compatibility re-exports instead of separate declarations.

The runtime still owns mutation, serialization, persistence and event delivery.
It persists acknowledgement before publishing a new snapshot. Stale projection
adds no synthetic history records. Driver write acceptance still does not mean a
physical action occurred and never changes an observation optimistically.

`semanticGraph(Project)` remains the only dependency projection. HMI screens and
Presentation signal references now contribute ordinary graph nodes/edges.
`graphImpact` is reused by refactoring and `core/inspection.ts`. Duplicate edges
are collapsed; cyclic metadata terminates without including the target in its
own impact set. Ambiguous human IDs require a namespaced semantic ID rather than
silently selecting another entity.

The shell owns selection and navigation. Its signal surface renders
`inspectSignal` and `signalHealth`; the same pure APIs can be used by terminal or
agent integrations without importing React or running a driver. Declared binding
metadata is labelled as configuration, not as proof that a protocol session is
connected. Existing visual equipment and two-way editing remain untouched.

## Clock and quality contract

`Sample.at` orders persisted events. `receivedAt ?? at` is measurement receipt
time. `sourceAt` is a potentially independent device clock and is never used to
infer server-side freshness. A stale initial placeholder at event time zero with
no receipt is unmeasured; a good sample at epoch zero remains valid for reports.

At the exact freshness limit a reading remains fresh; later it is stale. Invalid
or future receipt times are unusable and have explicit reasons. Browser transport
loss is observation context, not evidence that the field device itself changed.
Bad/offline severity and provenance flags survive projection. The projection must
always be made from the authority's snapshot, not written back by a UI.

## Compatibility and acceptance

No database migration, artifact schema bump, runtime credential change or new
dependency is needed. The changes remove duplicated decisions from existing
consumers; adding UI alone is not acceptance.

`tests/operational.test.ts` covers timing, quality, immutable projection, report
coverage and alarm transitions. `tests/inspection.test.ts` covers graph ownership,
HMI impact/diff, ambiguous IDs, cycles and missing dependencies.
`tests/operational-runtime.test.ts` covers persistence failure, clear-before-ack,
no synthetic stale history and non-optimistic command acceptance.

Run the actual repository typechecks, architecture guard and Bun tests. Passing
these tests is not proof of real protocol connectivity or visual acceptance.

## Remaining work, not implied by this decision

This slice does not implement command correlation/physical feedback/audit,
driver-status transport, raw protocol probing, lower/discrete/delayed alarm
conditions, dimensional expressions, archival range/replay APIs, scheduled jobs,
workspace switching, runtime process separation or hardware flashing. Their
existing acceptance criteria remain open in the capability matrix. Extend their
own domain contracts and tested transitions rather than adding independent state
machines to surfaces.
