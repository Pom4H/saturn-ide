# SCADA importer plugins

Saturn does not own external SCADA file formats. An importer is project-owned TypeScript
source that implements the public `ScadaImporter` contract and lowers an external format
into ordinary authored Saturn source.

```text
external project files
        ↓
project-owned parser / normalizer
        ↓
ScadaImportPlan
        ├── diagnostics
        ├── imports/<importer-id>/*.ts
        └── replacement project.ts
        ↓ explicit engineer review/apply
normal Saturn check → Git → publish → apply
```

## Minimal importer

```ts
import { defineImporter } from '@saturn/core';

export default defineImporter({
  id: 'example-format',
  label: 'Пример формата',
  accepts: ['.zip'],
  detect(source) {
    return source.files.some(file => file.path === 'PROJECT.JSON') ? 100 : 0;
  },
  import(source) {
    return {
      importer: 'example-format',
      sourceFingerprint: source.fingerprint,
      diagnostics: [],
      files: [{
        path: 'imports/example-format/project.ts',
        source: `import { project } from '@saturn/core';
export default project({ id:'imported', label:'Imported', equipment:[], pipes:[], alarms:[] });
`,
      }],
      projectSource: "export { default } from './imports/example-format/project';\n",
    };
  },
});
```

The IDE selects the highest positive `detect()` score among importers explicitly composed
by the project. Nothing is discovered or executed from a global registry.

## Project composition

A copied source kit is enabled explicitly in `browser.ts`:

```ts
import importer from './plugins/example-importer';

export default {
  importers: [importer],
};
```

An extension may export equipment definitions, protocol adapters, commissioning helpers,
importers or display factories. They remain normal TypeScript modules rather than
manifest-defined plugin kinds.

## Safety and ownership

- Raw archive bytes stay in the browser and are passed only to the selected importer.
- Generated files are confined to `imports/<importer-id>/`.
- Existing generated files are never overwritten silently.
- `project.ts` is compare-and-swapped against the version used for preview.
- Import modifies authored source only. It cannot publish, apply, flash or command equipment.
- Unsupported source semantics must remain explicit diagnostics/placeholders instead of silent loss.
- Imported presentation elements reference canonical Saturn signals; presentation is not modeled as equipment.
- An importer must not invent physical equipment, signal types, units, addresses or ownership without evidence in its source data.

Format-specific parsers, compatibility tables and migration evidence belong to the extension
that implements the importer, not to Saturn IDE.
