# First Saturn project

Saturn IDE and an engineering project are separate directories. The project contains authored
TypeScript and project-owned extensions; it does not contain a copy of the IDE.

## Start with the project screen

With an installed `saturn` executable, run:

```sh
saturn gui
```

From a Saturn IDE source checkout (Bun 1.4.2 or newer, Git, and `bun install` in
the IDE checkout), run `bun start gui`. When the selected directory has no
`project.ts`, Saturn opens a project screen in your browser instead of stopping
with a missing-project error.

Choose one of the three paths:

- **Create project:** choose the parent folder and a new folder name. Saturn
  creates a thin, empty engineering project, checks the model and opens the
  existing IDE. No dependency installation is needed for this first check.
  When Git is installed, Saturn initializes `main` or retains the existing
  parent repository and its remote. Without Git, the files still open locally;
  the IDE explains how to enable history and repository connection later.
- **Open folder:** select an existing directory. Saturn discovers `project.ts`
  files without executing them; if a repository contains several projects,
  choose the one to open. Recent entries store directory paths only.
- **Connect repository:** paste its HTTPS/SSH Git address and choose a new local
  folder. This path requires Git. Saturn clones the repository, then lets you
  choose its project.
  Cloning can be canceled or retried. Existing destination folders are preserved.
  Private repositories use the Git/SSH credentials already configured on the
  computer; do not put tokens or passwords into the repository address.

The launcher remains available while its project windows are open. Reopen the
same project from its recent list to reuse the existing workspace. After restarting
Saturn, enter through the launcher again; project windows use local session URLs.

The empty starter has `project.ts`, `package.json`, `tsconfig.json`, `README.md`
and `.gitignore`, plus Git metadata when available through the graphical launcher.
On the first IDE visit choose the desired interface preset. Use **Add equipment**
on the empty diagram, review the source preview and create the first device.
It appears on the real diagram and is attached with an ordinary TypeScript import
in `project.ts`. Saving, dragging and opening code use the same workspace model.

Opening the starter produces a **Checked** build. It has no simulator or physical
driver, so observations and **Applied** remain empty until a driver is explicitly
added. Source edits never apply changes to physical equipment.

### Direct commands

The command-line paths remain available:

```sh
saturn init ../my-plant
saturn gui --project ../my-plant
```

Use `bun start init ../my-plant` and `bun start gui --project ../my-plant` from a
source checkout. `init` only writes the five authored starter files; run `git init`
in that directory if using this CLI path. `serve --project <directory>` starts
without opening a browser and fails clearly for a missing project.

### GitHub workspace

Open [Saturn Cloud](https://saturn-ide.vercel.app/?workspace=1) to create a repository
or connect one by its URL. A new project defaults to the empty starter; the pumping
station remains an explicit template. GitHub sign-in returns to the selected
workspace and preserves the form. Repository and file navigation survive reloads.

If GitHub created a repository but file preparation was interrupted, use
**Continue setup** to finish that same repository. Recovery checks the Git revision
and stops if another author changed it. The source view also offers the exact local
commands for opening the selected project in Saturn IDE. Cloud source browsing does
not run arbitrary repository code inside the OAuth service.

To start a new equipment class, select **Собственный тип оборудования / Project-owned equipment**
in the Add equipment template list. The preview shows an ordinary `device()` definition in
`equipment/<ID>.device.ts`, plus its explicit `project.ts` import. The generated class has an
editable 2D SVG placeholder and no physical ports or measurements. Add `terminal()` entries only
after confirming the connector position, medium, family, direction and capacity; add `signal()`
entries for actual measured or commanded values. The editor and project check use these same typed
definitions for the diagram, HMI and topology. Its initial 3D shape is a neutral generic volume,
not a device-specific model.

For a measured instrument, declare a project-owned device with one numeric signal
and an `instrument` capability. The same form and reading appear in 2D and 3D:

```ts
const pressureGauge = device({
  id: 'pressure-gauge', icon: 'sensor', ports: {},
  signals: { value: signal({ initial: 0, unit: 'bar', min: 0, max: 16 }) },
  capabilities: {
    diagram: { width: 100, height: 110 },
    instrument: { form: 'dial', field: 'value', precision: 1, mount: { pipe: 'discharge' } },
  },
});
```

Add `pressureGauge('PT-101', { label: 'Pressure', x: 400, y: 100 })` to `equipment`.
`discharge` must name a `pipe()` in that project. The authored position controls the
head placement; the tap follows the current pipe route. Omit `mount` for a standalone
indicator. For an inline flowmeter, use `form: 'inline'`, define fluid sink/source
ports, and connect those ports with ordinary `pipe()` declarations.

## Organize an installation

Declare physical systems in `project.ts` and assign each equipment instance to one system:

```ts
import { project, system } from '@saturn/core';
import { pump } from './equipment/pump';

const systems = [
  system('site', 'Plant site'),
  system('water', 'Service water', 'site'),
];
const equipment = [
  pump('P-101', { label: 'Circulation pump', system: 'water', x: 120, y: 180 }),
];
export default project({ id: 'plant', label: 'Plant', systems, equipment, pipes: [] });
```

`pump` is a project-owned device constructor in this example. The Object tree
shows the hierarchy; selecting a system fits its area in 2D or 3D. Group outlines follow the
authored device coordinates when you drag and save. A system is navigation and presentation
metadata; equipment, connections and signals remain the same project model.

You can inspect the first check at `http://127.0.0.1:3000/api/releases`: `checked` is a build
hash, while `published` and `applied` are initially `null`. `GET /api/state` has no project
problems when the starter checks successfully. The empty starter has no driver, so its runtime
mode is `offline` and it has no observed samples. A Checked build alone is not a running
simulator or a physical deployment.

## Run the example simulator

The complete pumping-station example has its own equipment, HMI and explicit simulator.
Clone `Pom4H/saturn-examples` next to the IDE checkout. Before opening a new clone,
install its project dependencies (including React) with GitHub SSH access. Machines using
only HTTPS credentials can use the temporary Git rewrite shown below:

```sh
cd ../saturn-examples/pumping-station
bun install
cd ../../saturn-ide
bun start gui --project ../saturn-examples/pumping-station
```

You can make an independent copy with
`bun start init ../station-demo --template pumping-station`. The template keeps the example's
authored extensions and dependency lock; run `bun install` inside the copy before opening it.
Development auto-preview only starts a declared
simulator while the current runtime is not live. Add `--manual` to keep Checked separate from
Applied while reviewing a change. Saving TypeScript is never an implicit live apply.

## Check TypeScript outside the IDE

The IDE's first check does not need `node_modules` in the new project. For a separate
`bun run check` inside the project, its `@saturn/core` dependency must be accessible to Bun.
The empty starter uses a pinned HTTPS dependency on the public Saturn IDE repository,
so a separate SSH key is not needed for that dependency:

```sh
cd ../my-plant
bun install
bun run check
```

Example projects can have additional private Git dependencies. Configure ordinary
Git credentials for those dependencies before installing them.

Commit the resulting `bun.lock` with the project. If the Git dependency is inaccessible,
`bun install` can fail even when the IDE check succeeded. The starter pins a published core
revision for reproducible standalone checking; a source checkout with newer unpublished code
can check against a newer core in the IDE. Avoid putting an access token in `package.json` or
the lockfile. See [Bun's Git dependency documentation](https://bun.com/docs/pm/cli/add)
for supported URL and credential setup.

The starter intentionally has no `server.ts`. Add one only when you choose a simulator or a
real driver; it is ordinary project source and passes through the same check, publish and apply
flow. Source Git, Checked, Published and Applied are separate identities in the IDE.
