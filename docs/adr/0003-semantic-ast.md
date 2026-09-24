# ADR-0003: Semantic AST is the engineering model

## Status

Accepted.

## Decision

Saturn edits the engineering domain, not duplicated tag tables. The authored TypeScript project remains the
single source of truth. Equipment instances own their local knowledge. Anonymous `signal({...})` declarations
inside equipment are materialized as `<equipment-id>.<field>`; `project.signals` is a derived runtime/index view.

Human tags are not durable identity. Equipment may declare `semanticId`; tools use it to follow rename/change
without interpreting delete+add. Signals owned by equipment carry owner/provenance metadata.

A derived semantic graph supplies references, blast-radius analysis, semantic diff and documentation. It is
recomputed from `Project` and must never become a persisted second IR.

All human-facing domain metadata and generated documentation are bilingual RU/EN through the existing
`Text`/`Locale` contract. JSDoc remains bilingual as well.

## Consequences

- A normal engineer no longer writes the same signal path twice.
- Source, Diagram, Signals, HMI, Reports and future AI actions can address the same semantic entity.
- Rename can preserve historian identity when a stable `semanticId` is authored.
- Documentation is traceability output from the live model, not manually synchronized prose.
- Explicit `signal("id", ...)` remains for global/integration signals and migration compatibility.