# Refactor verification

This note covers the architecture cleanup that separated editing state, project source-kit
replacement and format-specific importers from universal core.

## Layout editing

Diagram gestures are coordinated by a headless `LayoutEditing` operation. Documents remain the
single editable source buffer. Regression tests cover consecutive gestures, delayed saves,
cancellation, stale telemetry, independent files and preservation of unrelated manual edits.

## Source-kit replacement

`ProjectPlugins` performs staged replacement with provenance, source hashing and compare-and-swap
checks. Temporary-directory and checkout failures release the operation lock; staged files are
removed; a previous installed copy is restored if replacement fails. Local edits prevent update.

No extension is activated by listing or installing its source.

## Importer boundary

Format recognition and parsing do not belong to core. Core exposes only generic import source,
diagnostic and `ScadaImporter` contracts. Format-specific parsers, compatibility rules and
acceptance evidence live in source kits outside this repository.

Generic tests cover bounded archive reading, traversal rejection, stable logical fingerprints,
namespace-confined generated files and project-version fencing.

## Complexity

The refactor intentionally favors explicit ownership and failure behavior over minimizing physical
line count. Complexity measurements are useful only as local signals; correctness is established by
typed boundaries and regression tests.
