# Verification

This document records verification that belongs to Saturn IDE itself. Hardware profiles,
format-specific migration evidence, protocol implementation details and cloud-provider checks
belong with the corresponding project-owned source kit or integration repository.

## Core and architecture

The repository CI runs both TypeScript compilers, the architecture dependency guard and the
full Bun test suite. Core checks cover project validation, typed signals, physical topology,
source editing, retained revisions, installation fencing, SQLite persistence, reports,
resource indexing, language-service behavior and shell state.

The architecture guard verifies layer direction and forbids explicit `any` in product
TypeScript. It does not claim physical safety, protocol certification or visual fidelity of
an external extension.

## Project-owned extensions

Saturn treats copied extensions as ordinary TypeScript source. Resource discovery does not
execute them, and build/runtime activation happens only through explicit imports.

Generic acceptance fixtures verify that:

- `device()` is the single equipment-definition path;
- project-owned display factories can be supplied through `browser.ts`;
- protocol adapters remain outside core and bind through public acquisition contracts;
- importer extensions implement `ScadaImporter` without a global registry;
- importer output is confined to `imports/<importer-id>/`;
- import changes authored source only and cannot publish/apply a runtime revision;
- unsupported migration semantics remain explicit diagnostics/placeholders.

Implementation-specific acceptance belongs in the repository that owns that implementation.

## Runtime lifecycle

Tests cover immutable build transport, source/build/applied identity separation, publish/apply
compare-and-swap, restart restore, failed-start rollback, failed durable-write rollback,
fail-closed cleanup, command revision fencing and independent runtime execution.

The development host remains a convenience composition. Passing these tests is not evidence of
fault-tolerant production hosting or successful physical deployment.

## Browser and shell

Browser acceptance starts the actual local host and exercises project navigation, source editing,
2D/3D projections, telemetry, commands, alarms, reports, Git, responsive layouts and generated
Presentation elements. The terminal shell shares the same session/document contracts but does not
claim graphical parity.

Visual behavior owned by an external equipment/display extension is intentionally not asserted in
this repository.

## Data and protocols

SQLite behavior is exercised in the default CI run. PostgreSQL cases require an explicit disposable
test database and are not reported as successful when skipped.

Protocol-neutral acquisition tests verify ownership, quality/timestamps, backpressure, command
serialization, reconnect behavior and cleanup. Concrete protocol adapters may have additional
wire-level tests in their own source-kit repositories.

## Hardware boundary

Saturn IDE does not claim that a controller has been flashed, that a pinout is certified, or that a
device-specific compiler/emulator is correct. Those claims require implementation-owned provenance,
toolchain tests and hardware acceptance outside the IDE repository.

## Shared command shell, TypeScript completion and AI transport — 2026-09-24

Executed on macOS arm64 / Bun 1.4.2:

- `bun run check`: both TypeScript compilers and architecture guard passed
  (91 modules). The command engine is guarded as headless Shell.
- `bun test tests`: 140 passed, 3 skipped, 0 failed; 539 assertions across
  34 files. Skips remain the two unconfigured PostgreSQL cases and Linux RTU PTY.
  OpenTUI test setup emits React `act` warnings; its assertions passed.
- The new command integration test starts an actual Bun workspace host and
  TypeScript Language Service. It completes `booster.ru` and a token edited in
  the middle of the line, changes the existing document draft, explicitly saves
  with file CAS, and verifies manual preview preserves applied. It spawns the
  real external CLI for JSON, completion and batch; failed batch stops before
  later commands. The unit suite covers validation, expectedApplied, offline
  rejection, no synthetic readback, retained drafts on conflict, stale async
  completion rejection, history, raw code quoting/newlines and AI failure.
- `bun scripts/command-shell-browser-test.ts`: passed actual DOM keyboard Tab,
  arrows, Escape and history; topology candidates; genuine TS completion;
  shared editor draft and explicit save; panel persistence; failed/offline
  commands; assistant transport and unavailable-provider error; light/dark/390px
  without page errors or horizontal overflow. Dark/mobile frames were inspected.
  AI replies here use an injected adapter, not a real model call.
- Real OpenTUI testRender exercises Tab and Enter through native input, checks
  typed command payload and expectedApplied, and verifies the visible completion
  list. This is a renderer test, not a screenshot fabricated from a template.
- `bun scripts/shell-panel-test.ts`: passed existing panel persistence,
  resizing/restore, tab keyboard navigation, simulator commands/alarms and
  ack/retry, inspector bounds, failed draft preserving applied, offline/stale.
  The tab expectation now includes the pre-existing Assistant tab; restored
  height is compared to the actual prior height instead of assuming 200px.
- `SATURN_CAPTURE_ARTIFACTS=1 bun run test:browser`: passed real Bun dev,
  Firmverse RGB565 display/buttons, source live hints/JSDoc and drag, simulator
  commands/alarms, SQL report coverage, history, Git commit, palette, WebGL 3D
  and desktop/tablet/phone/HMI captures.

New frames: `artifacts/command-shell-{topology,typescript,light,dark,phone,
ai-unavailable,offline}.png`; browser recordings under
`artifacts/command-shell-recording`. Renderer text: `artifacts/command-tui.txt`.

This verifies the local workspace command path, simulator, SQLite and UI adapters.
It does not verify a paid AI provider, physical controls, SaaS authentication or
standalone runtime CLI authentication. AI replies do not execute commands. Full
browser/TUI editor parity and migration of every graphical controller to the
command core are not claimed. Source/catalog and applied identities remain distinct.

`bun scripts/interaction-test.ts` also passed the preserved terminal help, invalid
command/type errors and log filters, simulator stop/start and alarm logs, then
2D multiselect/trends, 2D/3D drag, plug rewiring, unplug/reconnect with persistence;
no browser page errors. `git diff --check` passed.

## 2026-09-25 — IDE executable, jobs and version metrics

Executed on macOS arm64, Bun 1.4.2. Changes also touch the sibling `saturn-saas` checkout.

- `bun run check`: TypeScript 7 + TypeScript 6, architecture guard **109 modules** passed.
- `bun test tests`: **144 passed, 3 skipped, 0 failed; 574 assertions, 147 tests / 35 files**. Skipped: two PostgreSQL integration tests (no database configured) and Linux-only Modbus RTU PTY. Existing OpenTUI React act warnings remain; assertions passed.
- New `tests/delivery.test.ts`: real Git bare remote divergence/fetch/ff-only refusal + successful pull; reviewed new-commit restore; old HEAD rejection; real Bun workers with authored dependency order and independent target failure; immutable idempotency receipts; restart marks running jobs interrupted; IANA cron matching; SQLite run provenance and A/B null/coverage/end-of-run semantics; manifest validation.
- `SATURN_CAPTURE_ARTIFACTS=1 bun run test:browser`: full existing real-host suite passed: Firmverse pixels, source virtual values, drag/TS/JSDoc, commands/motion/alarms, reports, Git, WebGL and responsive/HMI.
- `bun scripts/delivery-browser-test.ts`: real browser Git DAG/restore preview, light/dark/390px, two actual simulator builds and separate runs, A/B comparison (`2.95 → 3.45 bar`, Δ `0.5`, measured coverage), real unavailable release-service state. Recordings: `artifacts/delivery-recording`; frames: `delivery-git[-dark|-phone].png`, `delivery-compare.png`, `delivery-updates.png`. Frames visually inspected. Simulator values are test fixtures, not plant measurements.
- `bun run ide:build`: native macOS ARM64 executable, **91,568,754 bytes**, SHA-256 `42ab137204d6103b71f8d12717bd2e977171edc8c953d1a3b0e1f2d24626a325` (build at this verification point). `bun scripts/ide-smoke.ts` passed from a temporary directory: embedded CLI schema, own typed TS project, browser bundle, running host and attached JSON CLI; no IDE checkout beside the executable. Binary/receipt/checksum under `artifacts/distribution`. Matrix Windows/Linux/Intel builds are defined but have **not** run here. No notarization/signing claim.
- SaaS: `bun run check`, **16 tests / 72 assertions**, `bun run build` passed. Nitro generated **10 steps, 3 workflows**. Existing optional `bufferutil`/`utf-8-validate` tracing notices remain. Follow-up auth test after stricter malformed-session handling: **6 passed / 21 assertions**.
- `bun scripts/workflow-worker-test.ts`: **real built Nitro + Workflow SDK local world + real Bun Worker + real SQLite archive**. Two workflow runs for one cron slot produced one report execution receipt and actual JSON/CSV with partial coverage. Also exercised a manual SDK deployment DAG from an exact Git commit, per-step worktrees, deliberately failed PLC fixture and successful independent operator follow-up; configured environment value redacted. GitHub authorization in this integration test uses a narrow local fixture; target commands are fixtures, not real deploys. This caught and fixed SDK step-discovery failure (directives need their own lines).
- `bun scripts/delivery-site-test.ts`: actual built SaaS download page, anonymous access, Windows/macOS/Linux cards and 390px layout. Missing published assets shown explicitly. Desktop/mobile frames and video under `artifacts/delivery-downloads*.png`, `artifacts/delivery-site-recording`; visually inspected.
- `git diff --check` passed in both repositories.

Not verified/claimed: public website deployment or binary publication; non-macOS executable execution; production Workflow Postgres World/HA; live PLC flashing or operator rollout; complete old report typed-schema/XLSX/render-target parity. No project was physically deployed. Source changes remain in the workspaces.

## 2026-09-25 — перенос typed report schemas и XLSX

Рантайм: macOS arm64, Bun 1.4.2 (744846f84), TypeScript 7 + TypeScript 6.
Сопоставлены `90da21a:plant/reporting.ts`, `types.ts`, `workflows.ts`, старые
report acceptance vectors и текущие execution paths. В baseline найдены
Excel-specifications; XLSX renderer там не найден. Новый renderer создаёт OOXML.

Фактически выполнено:

- `bun run check` — оба TypeScript и architecture guard: **113 modules**, PASS.
  `tests/report-schema-types.ts` включает отрицательные проверки numeric formats
  для text/boolean, неизвестных колонок/сортировок и вывода ReportRow.
- `bun test tests` — **153 pass, 3 skip, 0 fail; 613 assertions / 156 tests / 36 files**.
  Skip: два PostgreSQL cases (TEST_POSTGRES_URL не задан) и Linux RTU PTY на macOS.
  Существующие предупреждения OpenTUI act(...) остаются; тест проходит.
- После объединения CSV writer: `bun test tests/domain-contracts.test.ts tests/report-api.test.ts`
  — **10 pass, 1 PostgreSQL skip**, PASS; `bun run check` повторно PASS.
- `tests/report-migration.test.ts` — **9 pass / 39 assertions**. Старый вектор
  time-weighted mean **17.5**, coverage **80%**; NULL, schema mismatch, datetime,
  missing aliases, quoted SQL text, read-only capsule, literal XLSX strings,
  multi-sheet/sort/format/freeze/filter, immutable result + persisted raw snapshot.
  SQL Cartesian runaway действительно принудительно завершён через 5 секунд;
  event loop родителя продолжает работать.
- `bun scripts/report-browser-test.ts` — настоящий checked project и Chromium:
  прежний агрегатный отчёт, typed query report, числовой input, gaps/table/chart,
  настоящая загрузка XLSX, неизменные bytes при появлении новых measurements,
  HTML print media, light/dark/390px и явный failed state. PASS, page errors = 0.
  Записи: `artifacts/report-recording/`. Кадры: `report-aggregate-migrated.png`,
  `report-typed.png`, `report-typed-table.png`, `report-typed-dark.png`,
  `report-typed-phone.png`, `report-failed.png`, `report-print.png`.
  Кадры desktop/mobile/print визуально просмотрены.
- `python3 scripts/verify-report-xlsx.py` — независимое **read-only openpyxl**
  чтение `report-migration.xlsx` и реальной браузерной загрузки `report-browser.xlsx`.
  Проверены exact numeric/date values, NULL vs 0, boolean, строка `=1+1` без formula,
  порядок строк, 2 листа, formats/widths/filter/freeze/footer. Warnings-as-errors, PASS.
  Нативные Excel/LibreOffice не запускались.
- `bun scripts/report-worker-test.ts` — настоящий Bun Worker: typed SQL + input,
  idempotent completed receipt, authenticated/project-bound XLSX download;
  после restart и DELETE исходных samples bytes прежние. PASS.
- В `saturn-saas`: `bun run check`, `bun test tests` (**16 pass / 72 assertions**),
  `bun run build` — PASS.
- `bun scripts/workflow-worker-test.ts` — собранный Nitro + настоящий Workflow SDK
  local world + Bun Worker + SQLite: ручной typed SQL report, scale=2 -> **14**,
  actor из authenticated session, XLSX через серверный gateway, cron dedup,
  прежний deployment DAG. PASS. GitHub authorization API в этом fixture подменён;
  workflow/worker/storage/download исполняются реально. Production Postgres world
  и внешний deployment этим тестом не подтверждены.
- `bun run ide:build` + расширенный `bun scripts/ide-smoke.ts` — native standalone
  macOS arm64 с нуля в temp directory без checkout: TS project + GUI/CLI,
  отдельный SQL subprocess (**12.5**) + настоящий XLSX. PASS.
  Бинарник `artifacts/distribution/saturn-darwin-arm64`: **91,585,266 bytes**,
  SHA-256 `d5f217b0f3b916358070652f509f9a0d80ecb346fefbce4686390a8f9fcc6050`.
  Windows/Linux/Intel mac этим запуском не проверены.
- `git diff --check` в IDE и SaaS — PASS. Test servers/workers остановлены.

Граница результата: XLSX и typed schema/SQL contracts доступны из одной authored
модели и общего runtime. Старые произвольный Presentation/view и notification/outbox
сохраняются как открытые критерии паритета; не объявлены завершёнными.
Миграционные решения и пример: [report-migration.md](report-migration.md).

## 2026-09-25 — consistent entity details and shell UX

Executed on **macOS arm64, Bun 1.4.2, local Chromium/Playwright**:

- `bun run check`: TypeScript 7 + TypeScript 6 and architecture guard — PASS,
  **115 modules**. No new authored model or runtime authority in the shell.
- `bun test tests`: **154 pass, 3 skip, 0 fail; 622 assertions, 157 tests,
  37 files**. Skips: two external PostgreSQL cases and the RTU serial/PTY case.
- `bun test tests/deployment-inspection.test.ts`: **1 pass, 9 assertions**;
  actual authored plan, const references/shorthand/satisfies, computed/invalid
  fallback, circular references, no execution of project code. Existing plans
  are never replaced by the initial template in the inspector.
- `bun scripts/details-browser-test.ts`: PASS. Real equipment, signal,
  connection, alarm, report, HMI, target, plugin, file and project inspectors;
  relation navigation; typed command remains unchanged by arriving samples;
  export menu; authored deployment fields and card overflow check; source
  action deduplication; dark theme, 390px, closed inspector and offline command
  gate/last-known observation. No page errors. Screenshots `artifacts/details-*.png`,
  recordings `artifacts/details-recording/`. Desktop equipment, deployment,
  plugin, report menu, offline and phone frames visually inspected; fixed a
  discovered nested `dl` style collision in deployment cards.
- `bun scripts/report-browser-test.ts`: PASS. Aggregate and typed SQL report,
  input bounds with local invalid-input alert, gaps/coverage, real XLSX and HTML
  downloads from the export menu, stable bytes, light/dark/phone/print.
- `bun scripts/shell-panel-test.ts`: PASS. Persistent panel, keyboard tabs,
  resize/maximize/hide, draft preservation, live alarms and acknowledgement
  failure/retry, inspector bounds, mobile, failed build and offline/stale.
- `bun scripts/browser-test.ts`: PASS. Real dev host; Firmverse RGB565 + four
  navigation keys; TypeScript language service; source observations; commands,
  SVG animation, alarms, reports, Git, 2D/3D routes and display; desktop/tablet/
  phone/HMI. Context navigation now uses the single Go to menu.
- `bun scripts/interaction-test.ts`: PASS. Live multiselect trends, 2D/3D
  equipment drag, plug rewiring, durable unplug/reconnect, Fit through View.
- `git diff --check`: PASS.

The shared inspector is a read-only projection of the current model, resource
catalog, source buffers and observations. Checked and runtime identities remain
separate. Missing source locations and observations are explicit. Static plan
inspection intentionally returns a source link for computed plans it cannot
interpret; it does not evaluate authored code. These checks establish the listed
UX behaviors, not full old-product parity or native Windows/Linux verification.

## 2026-09-25 — readable Git, explorer projections and project starter

Runtime: **macOS arm64, Bun 1.4.2, actual local Chromium/Playwright**.

- `bun run check` — PASS, both TypeScript compilers and architecture guard,
  **118 modules**.
- `bun test tests` — **158 pass, 3 skip, 0 fail; 646 assertions, 161 tests,
  39 files**. Same external PostgreSQL (2) and RTU/PTY (1) skips; existing
  OpenTUI act warnings remain. Afterwards the expanded Git review test was run
  separately: **2 pass, 21 assertions**, including an unborn Git HEAD.
- Git review tests: parent→commit versus HEAD→restore direction, root and unborn
  commits, project-scoped nested repositories, actual old/new values, stable-ID
  rename/move, imported factory aliases, ignored formatting/comments, untracked
  file content, no summary for an unrelated local function named alarm.
- Project template tests: exactly five files; actual Builder checks the empty
  model and a generated pump + explicit import; no driver. Existing full station
  scaffold acceptance remains and is selected explicitly with its template name.
- Source launcher `bun src/host/application.ts init <temporary-path>` — PASS:
  exactly project.ts/package.json/tsconfig.json/README.md/.gitignore.
- `bun scripts/explorer-git-browser-test.ts` — PASS, real source/Git fixtures:
  Objects/Icons/File list/Folders, typed resource icons, keyboard navigation,
  persistent view choice, actual AST property diff, additions/deletions and
  syntax colors, distinct restore preview, dark theme and 390px. A/B disclosure
  absent while measurement history is visible. No page errors. Recording:
  `artifacts/explorer-git-recording/`; frames `explorer-objects.png`,
  `explorer-icons.png`, `explorer-flat.png`, `explorer-folders.png`,
  `git-ast-diff.png`, `git-ast-dark.png`, `git-ast-phone.png`,
  `git-restore-diff.png`, `history-without-comparison.png`.
- `bun scripts/project-template-browser-test.ts` — PASS: actual empty starter
  host → Add equipment → source preview → create → checked P-01 on diagram.
  No driver or fabricated observations. Frames `project-template-empty.png`,
  `project-template-first-device.png`; recording `project-template-recording/`.
- `bun scripts/delivery-browser-test.ts` — PASS: DAG/restore preview,
  light/dark/mobile, retained run provenance, removed comparison UI, update state.
- `bun scripts/browser-test.ts` — PASS: original diagram, source, language
  service, real commands/alarms, Git commit, reports, 2D/3D and HMI behaviors.
  It explicitly selects Folders before exercising the file-tree contract.
- Object/icon explorer, colored Git diff, dark/mobile and both starter frames
  were visually inspected. A transient missing graph during implementation was
  caught by the browser test, restored and rerun successfully.
- `git diff --check` — PASS. Temporary fixture servers/directories were closed.

Scope: syntax summaries do not execute historical projects or infer physical
outcomes. Full diff remains available and capped previews are marked. The native
IDE executable was not rebuilt in this turn; the source launcher/GUI were tested.
External `bun install` in the starter was not run. The station example and vendor
visuals remain intact. See [project-structure.md](project-structure.md).
