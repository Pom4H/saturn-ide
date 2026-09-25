# SCADA importer plugins

Saturn does not own legacy SCADA formats. An importer is project-owned TypeScript source that
implements the public `ScadaImporter` contract and lowers a vendor format into ordinary authored
Saturn source.

```text
legacy files
    ↓
vendor parser / normalizer
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
  id: 'vendor-scada',
  label: { en: 'Vendor SCADA', ru: 'Vendor SCADA' },
  accepts: ['.zip'],
  detect(source) {
    return source.files.some(file => file.path === 'PROJECT.INI') ? 100 : 0;
  },
  import(source) {
    return {
      importer: 'vendor-scada',
      sourceFingerprint: source.fingerprint,
      diagnostics: [],
      files: [{
        path: 'imports/vendor-scada/project.ts',
        source: `import { project } from '@saturn/core';
export default project({ id:'imported', label:'Imported', equipment:[], pipes:[], alarms:[] });
`,
      }],
      projectSource: "export { default } from './imports/vendor-scada/project';\n",
    };
  },
});
```

The IDE selects the highest positive `detect()` score among importers explicitly composed by the
project. No importer is discovered or executed from a global registry.

## Project composition

A copied source kit is enabled explicitly in `browser.ts`:

```ts
import legacy from './plugins/vendor-importer';

export default {
  importers: [legacy],
};
```

A plugin may export other Saturn definitions as well. Equipment, protocols, commissioning helpers
and importers remain normal TypeScript modules rather than manifest-defined plugin kinds.

## Safety and ownership

- Raw archive bytes stay in the browser and are passed only to the selected importer source.
- The generated plan may only create files under `imports/<importer-id>/`.
- Existing generated files are never overwritten silently.
- `project.ts` is compare-and-swapped against the version used for preview.
- Import modifies authored source only. It cannot publish, apply, flash or command equipment.
- Unsupported legacy semantics must remain explicit diagnostics/placeholders instead of silent loss.
- Imported presentation elements reference canonical Saturn signals; a legacy widget is not fake equipment.

## LanMon 4 reference importer

The first reference implementation lives in `Pom4H/saturn-plugins/importers/lanmon4`. Its LM2
normalizer is ported from the migration work in `Pom4H/lanmon-cloud`. It preserves map geometry,
ADDR bindings and known static presentation objects. Scripts, ActiveX, object handlers, old binary
`.map` files and FastReport/ADO gaps stay visible as migration diagnostics.

The clean demonstration project is `Pom4H/saturn-examples/import-workspace`.
