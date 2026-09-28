# Verification

## GitHub Pages engineering showcase — 2026-09-28

Executed on macOS arm64, Bun 1.4.2:

- `bun run check`: TypeScript 7, TypeScript 6 and architecture guard passed (166 modules).
- `bun test ./tests/pages-demo.test.ts`: 2 passed, 13 assertions. The authored pump/tank/valve
  model, valid pipe routing, source-to-model values, and model-control-to-source edits were checked.
- `bun run pages:build`: static bundle built to `dist-pages/`; bundled JavaScript was 1.7 MB.
- `bun test ./scripts/pages-browser-test.ts`: actual Chromium, WebGL canvas present; 8 assertions
  passed at 1440×1150 and 390×844, including source edits, range/command controls, no horizontal
  mobile overflow, and no browser page errors. Screenshots were visually inspected. Preview data
  is local simulated telemetry only; no runtime server or physical equipment is connected.
- GitHub Pages workflow is configured to deploy on `main` and manual dispatch. Public deployment
  is not verified until the workflow completes successfully in GitHub Actions.

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

## 2026-09-27 — суточный срез продукта, маршруты и рабочее место

Среда: **macOS arm64, Bun 1.4.2, настоящий локальный Bun host и Playwright Chromium**.
Для браузерной регрессии использована временная копия `HEAD` проекта pumping-station
из соседнего `saturn-examples`; пользовательские изменения примера не перезаписывались.

- `bun run check`: оба компилятора TypeScript и architecture guard — **PASS,
  149 modules**. Перенесённый в core декодер восстанавливает общие ссылки `Signal`
  после JSON-транспорта; 3D Shell не импортирует runtime и применяет тот же
  `validateProject` к активному авторскому проекту перед подсветкой портов.
- `bun test tests`: **241 pass, 3 skip, 0 fail; 858 assertions, 244 tests / 52 files**.
  Пропуски: два теста без настроенной PostgreSQL и RTU PTY, доступный только на Linux.
  Старые предупреждения React `act` в OpenTUI не меняют результат тестов.
- `bun scripts/pipe-visual-browser-test.ts`: PASS на 2D/3D drag и drop.
  2D preview и сохранённая трасса совпали; кадры обеих проекций просмотрены.
  Скриншоты и WebM находятся в `artifacts/pipe-*`.
  Блокировка маршрута при физическом пересечении оборудования видна с причиной в
  обеих проекциях. В unit-сценарии 100 диагональных кадров труба `suction`
  оставалась корректной и не превышала 12 точек; проверены сохранение коридора,
  авторских `via` и перепланирование длинного старого cache.
- `bun scripts/interaction-test.ts`: PASS. Реальный браузер прошёл 2D/3D drag,
  переподключение `run-command` DO2 → DO1, отстыковку и повторное подключение DO2,
  выбор нескольких объектов и live trend; ошибок страницы нет. До исправления
  браузерный picker ошибочно получал пустой список портов из-за разрыва ссылочной
  идентичности сигналов при JSON-транспорте. Перед сохранением проверено
  `data-connection-target=PLC-01.DO1`; несовместимый AO1 не предлагается.
- `bun scripts/review-pane-browser-test.ts`: PASS для постоянной навигационной
  рейки, центральных Diagram/Source/Git/Environment и правого Review. Два
  последовательных drag обновляют открытый Git diff при неизменном списке Git
  status; CodeMirror и 3D canvas не размонтируются. Разделены draft, Git HEAD,
  Checked, Published и Applied; проверены 1440/390 px, светлая/тёмная темы,
  `failed`, runtime `faulted` и `offline`. Кадры `artifacts/review-pane-*.png`
  и запись `artifacts/review-pane-recording/` просмотрены.
- `bun scripts/workbench-rail-browser-test.ts`: PASS в Chromium на текущем и
  чистом проекте. Проверены шесть инженерных и четыре операторских раздела,
  клавиатурная навигация, 1100/390 px и отсутствие горизонтального переполнения.
  В manual preview видны Checked, `Applied —` и недоступность сравнения без
  применённой сборки. Кадры `artifacts/workbench-rail-*.png` просмотрены.
- `bun scripts/display-failure-browser-test.ts` и
  `bun scripts/sidebar-source-browser-test.ts`: PASS для явно недоступного
  project-owned дисплея в 2D/3D и настоящих исходников в дереве. Рядом стоящие
  оборудование, Shell и runtime остаются доступны.
- Финальная браузерная матрица на чистой копии проекта: **8/8 PASS** —
  `browser-test.ts` (12 checks, `SATURN_CAPTURE_ARTIFACTS=1`),
  `interaction-test.ts`, `details-browser-test.ts`, `report-browser-test.ts`,
  `delivery-browser-test.ts`, `shell-panel-test.ts`,
  `display-failure-browser-test.ts`, `sidebar-source-browser-test.ts`.
  Дополнительно `explorer-git-browser-test.ts`, `shell-navigation-test.ts` и
  `shell-menu-test.ts` — PASS. Устаревшие селекторы старых сценариев
  адаптированы к rail/контекстной панели без ослабления предметных проверок.
  Просмотрены, среди прочего, `artifacts/ide-3d.png`, `report-failed.png`,
  `details-offline.png`, `shell-panel-ack-failed.png`,
  `display-unavailable-3d.png`, `git-ast-diff.png`.
- Отдельные runtime-тесты проверили запись пустого telemetry run, атомарную
  смену provenance с bounded callback buffer, сохранение принятой версии report
  job, отказ импорта до записи при blocker-диагностике и настоящий SQL в
  переносимом runtime за пределами checkout. SaaS в соседнем checkout повторно
  проверяет GitHub-доступ перед созданием issue; `bun test tests` там: **16 pass,
  0 fail, 76 assertions**, `bun run check`: PASS.
- `git diff --check` в IDE и соседнем SaaS checkout — PASS. Временные browser
  fixture закрыты; авторские изменения в соседнем примере сохранены.

Этот срез не доказывает визуальный паритет со старым Saturn `90da21a`, авторизацию
оператора на сервере, независимость текущего dev-host от CPU/сбоя IDE, выполнение
реального PLC target, аппаратную безопасность или Windows/Linux/PostgreSQL
исполнение. Старые сценарии, перечисленные в `capabilities.md`, остаются критериями
приёмки.

## 2026-09-27 — product UX и SaaS workflow

Среда: **macOS arm64, Bun 1.4.2, Playwright Chromium**, собранный Nitro server
с локальными mock ответами GitHub/worker для браузерных сценариев. Это проверка
отрисовки и переходов, а не успешного удалённого deployment или физического apply.

- `bun run check` в IDE: **PASS**, оба TypeScript компилятора и architecture guard
  по 150 модулям. Финальный `bun test tests`: **244 pass, 3 skip, 0 fail,
  899 assertions, 247 tests / 53 files**; пропуски — PostgreSQL и Linux RTU PTY.
  `bun test tests/delivery.test.ts`: **5 pass, 55 assertions**,
  включая лёгкий список job без payload и детальную выдачу по ID.
- `bun run check`, `bun run build`, `bun test tests` в соседнем `saturn-saas`:
  **PASS, 17 tests / 82 assertions**. Сборка Nitro выполнена на darwin-arm64;
  её трассировка native dependencies не является проверкой Windows/Linux.
- `bun scripts/saas-product-browser-test.ts`: **PASS** на production сборке.
  Анонимный экран использует реальные light/dark кадры локального IDE вместо
  нарисованной схемы; активы загрузились на 1440/390 px, CTA ведёт к установке.
  Проверены 503 и частичный download manifest, HTTPS ссылки, отказ clipboard,
  GitHub mock session, переход к конкретному проекту, ручной полный SHA,
  скачивание CSV/XLSX/HTML из summary job, деталь по ID, устаревшая applied
  сборка, доступ к заданиям без `checks.read`, восстановление опроса после 503,
  черновик прав, конфликт версии policy и повторная загрузка. Сняты desktop,
  1100 и 390 px, светлая/тёмная темы; console page errors и переполнение
  основных карточек отсутствуют. Кадры `artifacts/saas-*.png`, включая
  `saas-home-dark-verified.png` и `saas-home-phone-verified.png`, просмотрены.
- `git diff --check` в IDE и SaaS: **PASS**. Временный Nitro процесс остановлен.

Внешние GitHub CI, production worker, публикация binaries и выполнение плана на
реальном оборудовании здесь не запускались. Выдача отчёта из настоящей локальной
runtime БД и durable worker отдельно покрыта `delivery.test.ts`, но не этим
mock браузерным сценарием.

## 2026-09-27 — авторский DX и публичные входные страницы

Среда: **macOS arm64, Bun 1.4.2, локальные Bun/Nitro hosts и Playwright Chromium**.

- `bun scripts/project-owned-device-browser-test.ts`: PASS — из пустого проекта
  создан собственный тип оборудования обычным TypeScript import, пройден Checked,
  показаны 2D SVG и нейтральная 3D проекция без вымышленных клемм и показаний;
  Applied остался пустым. Desktop/390 px и кадры `artifacts/project-owned-device-*`
  просмотрены. `bun test tests/project-authoring.test.ts`: 4 pass / 18 assertions.
- `bun scripts/project-diagnostics-browser-test.ts`: PASS — реальный save неверной
  координаты `x: 15001` сохраняет `POSITION`, RU сообщение и точный range в
  CodeMirror/Review. После несохранённой правки доменный маркер не выдаётся за
  актуальный, а TypeScript lint работает. Прежний Checked сохранён, Applied пуст.
  Host integration отдельно проверил `POSITION` и `PORT_QUANTITY`:
  `bun test tests/project-diagnostics.test.ts tests/project-authoring.test.ts` —
  5 pass / 37 assertions. Кадры `artifacts/project-diagnostics-*` просмотрены.
- `bun run check` и полный `bun test tests` после этих правок: **PASS**, 150
  архитектурных модулей, **244 pass / 3 skip / 0 fail / 899 assertions**.
- Корпоративный сайт в `../saturn-inc/sites/corporate`: переработаны главная,
  продукты, решения, контакты и новости; article/documents получили общий стиль.
  Chromium на локальной собранной версии для семи маршрутов на 1440/390 px:
  **14/14 PASS**, HTTP 200,
  один H1, без горизонтального overflow и page errors. `bun run check` в самом
  corporate site прошёл; новый внешний деплой не производился.
- Публичный IDE сайт в `../saturn/site`: новая инженерная история проекта и
  рабочие переходы; Chromium главной и `?mode=ide#workspace` на 1440/390 px —
  **4/4 PASS**. `npm run site:build`, `npm run site:check` и полный
  `npm run site:test:browser` — PASS. JSON экспорт многофайлового проекта
  доступен из UI, мобильные Signals и меню проекта открываются.
- `../saturn-inc/sites/engineering` проверен отдельно как портал технологического
  радара: 33 записи из `radar.json`, главная и detail на 1440/390 px —
  **4/4 PASS**, поиск/фильтр/ссылки работают, page errors и overflow нет. Его
  предметные страницы не переписывались. Общий `bun run check` в `saturn-inc`
  завершился двумя таймаутами VS Code CLI тестов при параллельной нагрузке
  (249 pass, 2 fail); отдельный повтор `bun test test/cli.test.ts` —
  **7 pass, 0 fail**. Поэтому общий check не записан как успешный.
- SaaS после последней правки landing copy: `bun run check`, `bun test tests`
  (**17 pass / 82 assertions**), `bun run build` и
  `bun scripts/saas-product-browser-test.ts` на собранном Nitro — PASS.
  Браузер использовал локальные mock ответы GitHub/worker; внешние CI и
  production deployment этим не проверялись.
- `git diff --check` прошёл в IDE, SaaS, публичном IDE сайте и `saturn-inc`.

Пока не закрыты общие размерности и derived expressions DSL, точность произвольных
проектных 3D/физических представлений, несовместимость authored форматов между IDE
и смежным VS Code Workbench, а также старые критерии из `capabilities.md`.

## 2026-09-27 — мониторинг, производительность и политики сигналов

Среда: **macOS arm64, Bun 1.4.2, локальный host, SQLite и Playwright Chromium**.
Пользовательские кадры Codex послужили референсом каркаса; живое чтение окна
Codex через Computer Use отклонила автоматическая проверка, поэтому изменение
его интерфейса именно в этот день не заявляется как самостоятельно проверенное.
Паттерны общего периода, обзора до детализации и перехода к первоисточнику
сверены с опубликованной документацией Grafana в `monitoring-ux-2026-09-27.md`.

- `bun run check` в IDE: **PASS**, включая TypeScript и архитектурную проверку
  **151 модуля**. Полный `bun test tests` после исправлений аудита:
  **258 pass, 3 skip, 0 fail, 997 assertions; 261 тест в 55 файлах**.
  Пропуски: две проверки PostgreSQL
  без `TEST_POSTGRES_URL` и Linux-only Modbus RTU PTY.
- `bun scripts/performance-dashboard-browser-test.ts`: **PASS** на настоящем
  Checked проекте с обычным импортом project-owned monitoring plugin и явным
  симулятором. Проверены warning → канонический сигнал → история/Properties,
  смена периода, пауза только отображения, таблица источников, архивный 503
  при работающей независимой диагностике, 1440/390 px в светлой/тёмной темах,
  отсутствие Applied и потеря связи с переходом monitoring в `unknown`.
  Live-индикатор требует `phase=running`, Applied и активный драйвер. Суточная история после
  выбора обновляется вручную, часовая — не чаще минуты; браузерный тест
  посчитал запросы и проверил отсутствие частого SQL-опроса на этих периодах.
  Скриншоты в `artifacts/performance-dashboard/` просмотрены; горизонтального
  переполнения и ошибок страницы нет.
- `tests/monitoring-extension.test.ts` проверяет импорт проектного плагина,
  Checked hash и semantic diff при изменении порога, JSON-перенос ссылок,
  качество/свежесть и реальный host с симулятором. `tests/signal-policy.test.ts`
  проверяет due-channel subset, отказ неподдерживаемой частоте до I/O,
  выборочный SQL-архив без потери живого alarm/snapshot, качество, telemetry
  run, срок отдельной строки и повторное открытие SQLite. Старый JSON/HTTP
  `read(abort)` с настоящим loopback остаётся покрыт `tests/acquisition.test.ts`.
  Дополнительные регрессии проверяют очередь старых наблюдений при compatible
  apply и запрет пересчёта тревоги по A на несвязанном наблюдении B.
- `bun run check` в соседнем `saturn-plugins`: **PASS**. Проверенная сборка IDE
  с копией исходника Modbus из этого репозитория использует текущий core и
  создаёт binding с индивидуальной частотой. Уже установленный пакет плагинов
  со старым Git pin остаётся на прежнем контракте; runtime сохраняет совместимый
  путь чтения и отказывает новой политике до открытия I/O. Отдельный live Modbus
  TCP тест со смешанными индивидуальными периодами ещё не выполнялся: subset
  dispatcher, сборка копии исходника и обычный live Modbus I/O проверены порознь.
- `git diff --check` в IDE и `saturn-plugins`: **PASS**. Внешняя публикация,
  physical I/O и hardware apply не выполнялись.

Старый `scripts/infrastructure-browser-test.ts` не стартовал: его соседний
fixture `../saturn-examples/infrastructure` отсутствует (`ENOENT` до запуска
Chromium). Новый браузерный сценарий покрывает dashboard и проектный плагин,
но не заменяет проверку именно старого OS collector. PostgreSQL schema/retention
остаются непроверенными в этой среде. Долгое хранение всех принятых отсчётов
поддерживается; потокового raw export для обучения ML и исторического
discrete-status timeline пока нет. Правила `monitor()` показывают текущее
состояние и не становятся runtime-тревогами.

## 2026-09-27 — минималистичный Shell и переключатель «Код / Объекты»

Среда: **macOS arm64, Bun 1.4.2, локальный Bun host и Playwright Chromium**.
Кадры пользователя послужили референсом оформления. Проверка выполнялась на
текущей рабочей копии, где параллельно присутствуют другие незавершённые правки.

- `bun run check`: **PASS**, оба TypeScript компилятора и architecture guard
  по 153 модулям. `bun run architecture:check` отдельно: **PASS**.
  `git diff --check`: **PASS**.
- `bun scripts/codex-shell-browser-test.ts`: **PASS**. В Chromium проверены меню
  «Код / Объекты», файловая и предметная проекции, исходник, SVG анатомия насоса,
  два кабеля, 3D canvas, светлая/тёмная темы, 390 px, закрытое меню и offline.
  Скриншоты `artifacts/codex-shell-*.png` просмотрены; WebM записаны в
  `artifacts/codex-shell-recording/`. Ошибок страницы нет.
- `bun scripts/workbench-rail-browser-test.ts`,
  `bun scripts/sidebar-source-browser-test.ts`,
  `bun scripts/explorer-git-browser-test.ts`,
  `bun scripts/shell-navigation-test.ts`,
  `bun scripts/shell-panel-test.ts`,
  `bun scripts/details-browser-test.ts`: **PASS** после обновления селекторов
  удалённых переключателей. Сценарии сохраняют предметные проверки, включая
  вкладки, черновики, навигацию, контекстные сведения и offline.
- `SATURN_CAPTURE_ARTIFACTS=1 bun scripts/browser-test.ts`: **FAIL** на строгой
  проверке `data-invalid-routes === 0` после drag насоса: в 3D показан один
  недопустимый маршрут `run-command`, пересекающий оборудование. Кадр
  `artifacts/ide-3d.png` просмотрен. Тест не ослаблен; визуальный паритет и
  корректность этой трассы этим запуском не подтверждены.

## 2026-09-27 — единая визуальная шкала Shell

Среда: **macOS arm64, Bun 1.4.2, локальный Bun host и Playwright Chromium**.
Добавлены общие токены размеров, отступов, радиусов и нейтральных состояний
навигации. Они применены к рейке, проводнику, меню, вкладкам, заголовкам и
контролам. Предметные SVG/3D и цвета качества данных не менялись.

- Финальный `bun run check`: **PASS**, оба компилятора и architecture guard
  по **155 модулям**. Финальный `git diff --check`: **PASS**.
- `bun scripts/codex-shell-browser-test.ts`: **PASS** после изменений. Проверены
  меню «Код / Объекты», 2D SVG и 3D canvas, исходники, светлая/тёмная темы,
  390 px и offline без ошибок страницы. Кадры `artifacts/codex-shell-*.png`
  просмотрены; WebM записаны в `artifacts/codex-shell-recording/`. Два
  промежуточных запуска остановились на 5-секундном ожидании lazy 3D и на
  старой английской строке `OFFLINE`; ожидание 3D увеличено до 30 секунд,
  проверка текста приведена к русской локали, финальный запуск прошёл.
- `bun scripts/workbench-rail-browser-test.ts`,
  `bun scripts/details-browser-test.ts`,
  `bun scripts/sidebar-source-browser-test.ts`: **PASS**. Просмотрены кадры
  схемы, исходников, отчёта, меню экспорта, тёмной нижней панели и 3D.
- `bun scripts/shell-panel-test.ts`: первый запуск остановился на устаревшем
  ожидании английского `OFFLINE` после того, как UI стал показывать русское
  «ОФЛАЙН». Ожидание локализовано, повторный запуск: **PASS** для вкладок,
  тревог, отказа квитирования, failed build, offline и stale.

Предыдущий отказ `browser-test.ts` на маршруте `run-command` остаётся открытым;
этот проход не перепроверял алгоритм трассировки после drag.

## 2026-09-27 — сквозная UX-консистентность и жизненный цикл объектов

Среда: **macOS arm64, Bun 1.4.2, локальный Bun host/SQLite и Playwright Chromium**.
Проверена общая рабочая копия после объединения изменений Shell, мониторинга,
инженерного drag/drop и экранов выпуска. `bun run architecture:check` отдельно:
**PASS, 157 модулей**; итоговый `bun run check`: **PASS** (оба компилятора и
архитектурная проверка); `git diff --check`: **PASS**.

- `bun test tests`: **262 pass, 3 skip, 0 fail, 1002 assertions; 265 тестов в
  56 файлах**. Пропущены два PostgreSQL сценария без `TEST_POSTGRES_URL` и
  Modbus RTU PTY, требующий Linux/последовательный адаптер.
- `SATURN_CAPTURE_ARTIFACTS=1 bun scripts/browser-test.ts`: **12/12 PASS**.
  Повторный реальный Chromium проверил 2D drag с сохранением исходника,
  Source/Language Service, команды и тревоги, SQL отчёты, Git, 3D WebGL,
  HMI и три ширины. Это закрывает ранее записанный отказ одного сценария
  `run-command` после того, как тест использует действительно свободный путь;
  отдельный тест намеренного столкновения сохраняет строгую ошибку маршрута.
- `bun scripts/interaction-test.ts`, `bun scripts/free-end-collision-browser-test.ts`,
  `bun scripts/engineering-consistency-browser-test.ts`: **PASS** по данным
  отдельного запуска: 2D/3D переподключение, свободный конец, подсказки портов
  и сохранённая после записи геометрия, без ошибок страницы. Кадры и записи
  лежат в `artifacts/free-end-collision/` и `artifacts/engineering-consistency/`.
- `bun test tests/compatible-ports.test.ts`: **3 PASS**; точные списки
  кандидатов совпали с полным `validateProject` для 514 портов и 14 вариантов
  труба/кабель/free/занятость/направление/тип/единица. Воспроизводимый
  `scripts/compatible-ports-benchmark.ts` на 128 устройствах показал медиану
  **69,83 → 3,08 мс** (p95 **83,36 → 3,71 мс**) при Bun 1.4.2. Это задержка
  подбора портов в тестовом проекте, а не обещание FPS для любой схемы.
- `bun scripts/lifecycle-ux-browser-test.ts` и
  `bun scripts/signals-lifecycle-browser-test.ts`: **PASS**. Chromium проверил
  Checked-only, изменённые и удалённые в Checked отчёты/сигналы/оборудование;
  центральный контракт и Properties согласованы, показания/команды/история
  относятся к Applied. При отсутствии Applied прямые GET истории и генерации
  отчёта возвращают 409; Checked-only сигнал не вызывает архивный GET. Для HMI
  проверены форма из Checked, Applied галерея и прямой URL без Applied. Кадры
  `artifacts/lifecycle-ux/` и `artifacts/signals-lifecycle/` просмотрены, включая
  изменённый диапазон Checked рядом с показанием Applied.
- `bun scripts/ux-walkthrough-browser-test.ts`: **PASS**, 30 кадров станции и
  пустого проекта на 1440/390 px, faulted/offline и закрытое Review без
  горизонтального переполнения и ошибок страницы. `bun scripts/shell-consistency-browser-test.ts`:
  первый запуск после API gate **FAIL** из-за старого ожидания запроса истории
  до Apply. Сценарий уточнён: до Apply запросов нет, после Apply скрытая
  вкладка прекращает SQL-опрос. Повторный запуск **PASS**. Также **PASS**
  `bun scripts/performance-dashboard-browser-test.ts` для project-owned
  мониторинга, истории, pause, источников, 1440/390 и offline.
- `bun scripts/report-browser-test.ts`, `bun scripts/details-browser-test.ts`,
  `bun scripts/authoring-browser-test.ts`: **PASS** по итоговым запускам
  ответственного агента после правок Checked/Applied. Снимки HMI, отчётов,
  свойств и узкого экрана просмотрены. Внешний hardware apply не выполнялся.

Публичные сайты проверены в соседнем `/Users/rom/Documents/saturn-inc/sites/`,
без публикации: corporate `bun run build` **PASS, 10 страниц**; engineering
`bun run check` **PASS, 34 HTML + source.json**; `git diff --check` **PASS**.
В Chromium шесть корпоративных маршрутов прошли на 1440/390/320 px без
горизонтального переполнения и ошибок страницы; мобильное меню, Escape, CTA и
14 логотипов проверены. Инженерный радар прошёл фильтр, пустой поиск и detail
на этих ширинах. Все 23 прямые ссылки документации вернули HTTP 200 при HEAD.
У 12 из 16 уникальных публичных evidence URL радара получен HTTP 404 на
27.09.2026: интерфейс показывает датированное «публичная ссылка недоступна»,
не делает их кликабельными и сохраняет исходные URL/факты. Доступность этих
внешних ссылок нужно повторно проверить перед публикацией.

Открытые критерии паритета: размеры и derived expressions DSL, произвольные
project-owned 3D/физические представления, replay/checkpoint, runtime-only
изоляция текущего dev host и визуальные эталоны старого Saturn для всех
stale/failed/closed состояний. Эти критерии остаются в `capabilities.md`;
проверка текущего UX не объявляет их выполненными.

## Checked simulation scenarios in the report worker — 2026-09-27

Runtime: macOS arm64, Bun 1.4.2. Added typed TS scenario declarations to the same
Project/BuildArtifact, a standalone runtime simulation API, and `scenario` jobs in
the existing report worker pool. No equipment geometry or physical model changed.

- `bun run check`: PASS, both TypeScript compilers and architecture guard,
  160 source modules (final run includes the CLI and all four new test files).
- `bun test tests`: 276 PASS, 3 SKIP, 0 FAIL, 1195 assertions, 59 files.
  This full run preceded the final CLI test and four runner tests; those were
  verified in the focused final run below. Skips remain PostgreSQL (two tests,
  TEST_POSTGRES_URL absent) and Linux Modbus RTU PTY on macOS.
- `bun test tests/scenarios.test.ts tests/scenario-runtime-api.test.ts tests/scenario-worker.test.ts tests/scenario-runner.test.ts`:
  final run 19 PASS, 0 FAIL, 223 assertions. Actual Builder imports the authored
  file; actual runtime host, SQLite, Bun Worker and a separate CLI process execute
  commands and check observations. Fixtures are generic command-response models,
  not a nuclear plant or a historical accident simulation.
- Rejected read/deploy credentials on scenario API, live/offline installations,
  wrong applied/run identities, read-only/type/range-invalid commands. Apply and
  commands share a queue; failed Apply restarting the same build invalidates the
  old run. Queued jobs recheck identities before executing.
- Verified duplicate input idempotency, conflicting duplicate rejection, one
  queued/running scenario per registered worker project, queued/running cancellation,
  persisted partial failure results, no later command after failure, no automatic
  command retry, and interrupted queued job remaining stopped across worker restart.
- Loopback tests reject equal values that are missing, bad, stale, expired, or
  from another run/build. A slow HTTP response is covered by the expectation
  deadline. A run change during wait stops the following command.
- `bun scripts/report-worker-test.ts`: PASS, existing real report worker path,
  applied-only submission, pinned build, SQL/input handling, XLSX, authorization,
  and artifact persistence after restart/pruning.
- `git diff --check`: PASS.

This verifies the simulation command execution mechanism. Full pre-accident
ChNPP-4 inventory/geometry/physics, historical initial conditions, model-clock
stepping/reset/checkpoints and Shell/dev-host scenario launch remain unfinished.
Wall-clock sequences cannot be claimed as deterministic physical replay. Worker
interruption does not reverse accepted commands or checkpoint each individual step.
See [runtime scenarios](runtime-scenarios.md) and
[nuclear twin evidence](../../saturn-examples/chnpp4/docs/nuclear-twin-evidence-2026-09-27.md).

## Model stepping and scenario Shell — 2026-09-27

Continuation of the previous scenario verification on macOS arm64, Bun 1.4.2.
Model stepping and browser/dev launch are now implemented; reset/checkpoint and
full plant fidelity remain open. The earlier section records its earlier run.

- `bun run check`: PASS, both TypeScript compilers and architecture guard,
  162 source modules.
- `bun test tests`: 293 PASS, 3 SKIP, 0 FAIL, 1406 assertions, 296 tests in
  62 files. This run preceded the two final shutdown regression tests and the
  final terminal-surface guard. PostgreSQL skips require TEST_POSTGRES_URL;
  Linux Modbus RTU PTY remains skipped on macOS.
- `bun test tests/scenario-dev.test.ts tests/simulation-clock.test.ts tests/server.test.ts tests/scenario-worker.test.ts`:
  21 PASS, 0 FAIL, 292 assertions. This includes standalone runtime shutdown;
  the additional dev shutdown case was verified separately below.
- `bun test tests/shell-model.test.ts tests/simulation-clock.test.ts tests/scenarios.test.ts tests/scenario-runner.test.ts`:
  final run 31 PASS, 0 FAIL, 222 assertions. Verified typed advance/range steps,
  build/run/time fencing, unsupported/live rejection, exact clock advancement,
  quarantine after invalid advancement, no fabricated or refreshed observations,
  repeatable fixture trajectory across wall-clock delays, and Shell model regression.
- `bun test tests/scenario-dev.test.ts`: final agent run 4 PASS, 0 FAIL,
  48 assertions. Actual dev gateway → Bun Worker → private runtime executes
  steps, retains failures, cancels, rejects stale identities/browser credentials
  on private endpoints, and refuses Checked-only/in-memory launch. Cooperative
  pending advance receives shutdown abort before queue drain; driver cleanup
  runs and late publications cannot replace the last accepted observation.
- `bun scripts/scenarios-browser-test.ts`: PASS in real Chromium against the
  dev gateway and actual worker. Success, failure with observed value, running
  cancellation, Checked versus Applied, 1440/390 px and light/dark states.
  No page errors or horizontal overflow. Recordings, screenshots and the run
  summary are in `artifacts/scenarios/`. Desktop success and narrow dark failure
  receipts were visually inspected; the final failure capture includes Russian
  error text with expandable original diagnostics.
- `git diff --check`: PASS.

The browser evidence preceded the final dev closed-admission guard; that change
was covered by the subsequent dev test run. No nuclear equipment geometry or
physical accident model was created by these generic fixtures. Driver cancellation
is cooperative; an in-process noncooperative driver is not forcibly isolated.
Individual observations still use historian timestamps, not a new model-time axis.
The scenario screen has no terminal renderer; the CLI remains available.

Primary-source research is recorded in
[ChNPP-4 equipment sources](../../saturn-examples/chnpp4/docs/chnpp4-equipment-sources.md), with applicability,
unresolved conflicts and downloaded PDF hashes. It does not establish a complete
as-built inventory or a verified 1:1 digital twin.

## Example ownership — 2026-09-28

Station-specific research documents and local source artifacts were moved to
`../saturn-examples/chnpp4/`. Runtime scenario documentation now uses a generic
example and records project ownership of physics, equipment, views and scenarios.
The architecture contract explicitly excludes branching on example identities.
Search of `src/`, `scripts/` and `tests/` found no ChNPP/RBMK-specific logic.
No executable plant model was introduced by this move. No production code changed.

`bun run architecture:check`: PASS, 162 modules. Relative links in the changed
documents and `git diff --check` in both repositories: PASS. Behavioral/browser
tests were not rerun for this documentation and local-artifact move.

## Preserved equipment calculations and scale probe — 2026-09-28

Runtime: macOS arm64, Apple M1, Bun 1.4.2. Equipment calculations are owned by
`../saturn-examples/chnpp4/`, not the IDE core. All 30 old model definitions retain
the original formulas, parameters and defaults from revision `90da21a`.

- In `saturn-examples`, `bun test chnpp4/tests/simulation-models-oracle.test.ts`:
  **5 PASS, 0 FAIL** (parent rerun 2.40 s). Test bundles verify 36 baseline source
  blobs and use the unchanged old Kernel/compiler. Only equipment lookup differs.
  All 30 model trajectories match; the complete 1600-step auxiliary control trace,
  reordered nodes, pause and checkpoint continuation match including PLC state.
  The ventilation counterfactual has a delayed response through the existing
  equipment equations and reproduces after checkpoint restoration.
- In `saturn-examples`, `bun run --bun tsc -p chnpp4/tsconfig.json`: PASS for
  the equipment definitions and oracle test code.
- Earlier `bun scripts/project-scale-benchmark.ts` run (05:03:42 UTC) observed
  the then-existing global 128-device/512-connection Project validation limits.
  Those limits were removed in the follow-up below. See the updated
  [measurement report](project-scale-2026-09-28.md) for the corrected capacity
  distinction and measured artifact boundary.
- Generated equipment signal banks: `bun test tests/generated-device-types.test.ts
  tests/core.test.ts`: **11 PASS, 304 assertions**. The type-only `device()` fix
  accepts normal position/label options with an `Object.fromEntries` signal bank,
  preserves statically known fields and command types, and leaves unknown dynamic
  fields as `unknown`. Runtime construction and validation are unchanged.
- After that fix, `bun run check`: PASS, both TypeScript checks and the architecture
  guard across 162 modules. These checks were run by the delegated implementation
  agent on the same workspace/runtime.

## Separate authored-project size from diagram routing budget — 2026-09-28

On macOS arm64 / Apple M1 / Bun 1.4.2:

- `bun test tests/core.test.ts tests/source-authoring.test.ts
  tests/compatible-ports.test.ts`: **20 PASS, 0 FAIL, 82 assertions**. Covers
  129 devices, 513 connections, per-port cardinality rejection, and selecting a
  route projection without dropping source edges.
- `bun scripts/routing-budget-browser-test.ts`: **PASS** in actual Builder and
  Runtime. Source project has 130 devices / 513 connections; Builder accepts all
  of them, diagram renders 16 connection routes per page, next page renders the
  exact `E16`–`E31` set, and all 513 authored edges remain. At a 390 px viewport,
  the toolbar has no document-width overflow and the browser reports no page
  errors. Captures: `artifacts/routing-budget/first-page.png` and
  `artifacts/routing-budget/mobile-page.png`.
- Repeated `bun scripts/project-scale-benchmark.ts`: **exit 0**. Project validation
  and the full artifact/decode/Runtime/SQLite `:memory:` path passed at 1024
  equipment / 8192 signals (model 2676022 chars; 24579 rows; zero write errors).
  At 2048 equipment / 16384 signals, Project validation passed but BuildArtifact
  rejected the 5417078-character model. Both 512 and 513 connections passed.
  This is a synthetic single-process measurement, not browser, disk, physical
  simulation or production capacity evidence.
- `bun run check`: PASS after the implementation; TypeScript checks and
  `architecture:check` completed (163 module guard).
- `git diff --check`: PASS.

The editor pages route calculation above 64 authored connections in groups of 16.
Every device is still rendered on the scene, so small-device rendering and browser
responsiveness for large complex diagrams remain unverified.

The oracle is not proof of a full station replica, calibrated physics or current
IDE Driver integration of the old complete project. The scale probe does not
exercise routing, browser, source compilation, network or physical simulation.
No new solver or plant-specific runtime behavior was introduced.

## Screenshot audit follow-up — 2026-09-28

Changes and limits: [UX follow-up](ux-overlay-followup-2026-09-28.md).
Environment: macOS arm64, Bun 1.4.2, actual Bun dev hosts and Playwright Chromium.

Parent executions:

- `bun run check`: PASS, both TypeScript compilers and 162-module architecture guard.
- `bun test tests/panel-layout.test.ts tests/assistant.test.ts`: 3 PASS, 0 FAIL,
  12 assertions. Environment layout changes preserve working panel state;
  absent release identities are not reported as matching builds.
- `bun scripts/environment-polish-browser-test.ts`: PASS. Separate environment
  panel state, retained terminal draft/log, Checked-only status, expandable build
  identities with phase always visible, 1440/390, dark/offline. No page errors or
  horizontal overflow. Evidence: `artifacts/ux-polish/environment/`.
- `bun scripts/review-pane-browser-test.ts`: PASS. Diagram drag updates Git diff,
  central 3D/editor remain mounted across right-pane switches, source draft and
  Checked/Applied identities remain distinct, failed/offline and mobile states.
- `bun scripts/shell-panel-test.ts`: PASS. One persistent panel, tab keyboard,
  resize, collapse, terminal draft/log, alarms/ack/retry, failed-build and stale
  states, mobile/theme coverage. No page errors.
- `bun scripts/scenarios-browser-test.ts`: PASS after final panel-context change.
  Actual worker success/failure/cancel, first entry with collapsed panel, separate
  open-panel indicator, expected/observed comparison with label/unit/quality,
  receipt unchanged by selected plan, and no current assertions substituted into
  an old-build receipt. 1440/390 light/dark; no page errors or horizontal overflow.
  Evidence: `artifacts/scenarios-ux-polish/`.

Delegated executions on the same workspace/runtime:

- `bun scripts/performance-dashboard-browser-test.ts`: PASS. Separate zero runtime
  alarms and one rule breach, measurements visible on first desktop screen and
  first mobile measurement above footer, search-to-trend navigation, pause/offline,
  unavailable archive and no-Applied states. Evidence: `artifacts/performance-dashboard/`.
- `bun scripts/project-owned-device-browser-test.ts`: PASS. Explicit generic 3D
  notice, actual Open source navigation, Checked-only equipment and 390 source preview.
- `bun scripts/display-failure-browser-test.ts`: PASS. 2D display diagnostic opens
  PLC source, 3D exposes actual reason, last-known scene remains after host closure.
- `bun scripts/free-end-collision-browser-test.ts`: final PASS after adding
  collapsible diagnostic cards. Persisted drag produces the actual clearance
  error; 2D keyboard and 3D focus actions select the free end, collapse details,
  and allow reopening without losing focus. At 390 px the collapsed card is
  under 70 px high and the endpoint remains visible. No page errors.
  Evidence: `artifacts/free-end-collision/`. Final delegated `bun run check`
  also passed after this follow-up; `git diff --check` is clean.

Parent visually inspected fresh scenario comparison/mobile receipt, monitoring
desktop, environment desktop/mobile, custom equipment 3D and unavailable display
3D frames. These changes clarify existing states and actions; they do not add a
physical solver, a full station model or checkpoint restoration.

## Auxiliary operator integration — 2026-09-28

Runtime: macOS arm64, Bun 1.4.2. Station-specific code remains in
`../saturn-examples/chnpp4`; current project is explicitly an auxiliary validation
lab, not a complete NPP. See its docs/operator-lab.md and engineering-model-contract.md.

- Parent `bun run check`: PASS, TS6/TS7 and architecture guard163 modules.
- Parent `bun test tests/simulation-model.test.ts`:6 PASS,414 assertions.
  Previous-frame semantics, ordering, bad-input propagation, immutable snapshots
  and all-or-nothing frame commit. No claim of complete old Kernel parity.
- Delegated `bun scripts/hmi-multiple-commands-browser-test.ts`: PASS, real host
  and Driver, second/third commands independently dispatched, read-only excluded,
  authored HMI order,1280/390px and390x480 scrolling. Agent visually inspected
  recorded frames in artifacts/hmi-multiple-commands/.
- Parent from examples/chnpp4: `bun test --timeout 30000
  tests/operator-runtime.test.ts tests/operator-simulation-parity.test.ts
  tests/emergent-auxiliaries.test.ts tests/simulation-models-oracle.test.ts`:
 13 PASS,0 FAIL,71 expect assertions plus18036 strict output comparisons.
  Initial concurrent run exceeded the default5s deadline on full old1600-step
  oracle (6.60s); rerun with explicit30s deadline passed, same assertions.
- Example `bun run --bun tsc -p chnpp4/tsconfig.json` (strict indexed reads): PASS.
  Running from chnpp4 avoids a Bun1.4.2 --tsconfig-override warning encountered
  from the repository root; no compiler suppression added.
- All30 model formulas retain baseline computational text after removing only
  global registration and erased s/i/q property non-null assertions. Current
  copied source SHA25682a120800a56ab4a0dcfdce0460d357ba888b8a1cbb065c71861ae9eea673a2c.
- Actual in-app browser at localhost4102: selected authored OP, navigated to
  reservoir and back, sent OP.air=.5 and OP.heat=.2 with HMI confirmations.
  Runtime readings subsequently showed fan airflow.5000005883, cooler.5261656120
  and delayed sensor.5254961693 at model171s. Values are normalized.
- Clicked Run scenario through Shell; actual shared worker completed all8steps
  on build379f3391f9bc, job b8103f0e-9d24-4240-8cc0-6ba068f71a08.scenario.
  Advanced258400→318400ms; airflow.5000000000000017, temperature.5872946884,
  reservoir residual−7.077e−17, paused confirmed. Left the example open.
  Screenshots/observations: artifacts/auxiliary-operator/. The original IAB tab
  stopped responding to automation after host restart; a fresh tab worked.
- `git diff --check`: PASS in IDE and examples.

The auxiliary counterfactual tests establish delayed causal paths, not nuclear
calibration. A two-vessel test exposes a transient0.04 vessel-only inventory
deficit from previous-step transfer; no explicit pipe inventory exists. This is
a recorded open defect, not a conservation pass. The full station, physical
port geometry, general3D equipment and nuclear operating model remain unimplemented.

## 2026-09-28 — multi-device operator HMI overview

Runtime: macOS arm64, Bun 1.4.2, local Playwright Chromium. This is a generic
HMI behavior improvement; equipment definitions and runtime contracts are unchanged.

- A screen configured with more than four devices opens to a system overview.
  Cards show equipment ID/name/kind, up to four read-only signals, units and
  whether each sample is current or unavailable. Additional signal count is
  disclosed. Selecting a card opens the existing schematic/detail view and its
  writable commands. Detail view provides a direct return to overview. Smaller
  screens retain their prior initial detail view.
- `bun scripts/hmi-overview-browser-test.ts`: PASS. Six-device fixture exposes
  all cards and latest measurements; selecting a device opens its detail; a
  command reaches the actual simulation Driver and updates the runtime sample;
  desktop and 390×480 layouts have no horizontal overflow or page errors.
- `bun scripts/hmi-multiple-commands-browser-test.ts`: PASS. Existing two-device
  HMI keeps detail mode; independent commands, read-only exclusion, acknowledgments,
  authored equipment order and short-panel scrolling still work.
- Visually inspected `artifacts/hmi-overview/overview-desktop.png`,
  `equipment-detail-desktop.png` and `overview-mobile.png`.
- `bun run check`: PASS, TypeScript 7/6 and the 163-module architecture guard.

The cards are a summary, not a replacement for trends, alarms, system hierarchy,
or device-specific operator graphics. Selecting the device retains access to its
existing full detail and controls.

## 2026-09-28 — восстановление физической группировки Saturn

Сравнение проведено со старым Saturn `90da21a`: `plant/dsl.ts` (`system`),
`plant/group-layout.ts`, `src/view.ts`, `src/view3d.ts` и старые
`plant/tests/group-layout.test.ts`. Перенесены декларация системы, проверка
вложенности/принадлежности, вычисляемые подложки и фокус в обеих проекциях.
Группы не создают оборудование, сигналы или отдельный runtime.

- `bun test tests/system-grouping.test.ts tests/core.test.ts
  tests/source-authoring.test.ts tests/acquisition-integration.test.ts`:
  **28 PASS, 0 FAIL, 152 assertions**.
  Проверены BuildArtifact/decode round trip, вложенные bounds, пересчёт bounds
  после изменения координаты, отсутствие мутации авторского проекта и ошибки
  отсутствующего родителя, цикла и неверной принадлежности оборудования.
  Семантический review видит изменение группы/принадлежности; смена только
  группировки не меняет acquisition key и не требует перезапуска драйвера.
- `bun scripts/system-grouping-browser-test.ts`: **PASS**, настоящий Builder и
  Runtime. Проект с тремя системами и тремя устройствами показал три 2D-подложки,
  дерево систем и фокус после выбора системы в боковой панели и на подложке.
  При source-backed drag `W1` граница системы сдвинулась вслед за оборудованием;
  изменённая координата сохранилась в `project.ts` и сохранилась после reload.
  WebGL 3D выдал кадры с тремя групповыми подложками. При 390 px выбор системы
  через мобильную навигацию не вызвал горизонтального переполнения или ошибок
  страницы. Снимки: `artifacts/system-grouping/2d-system.png`,
  `2d-after-drag.png`, `3d-system.png`, `mobile-system.png`.
- `bun run check`: **PASS**, TypeScript 7/6 и проверка архитектуры 164 модулей.
- `bun test tests/universal-signals.test.ts tests/inspection.test.ts
  tests/monitoring-extension.test.ts`: **16 PASS, 0 FAIL, 70 assertions**;
  существующая семантика сигналов, мониторинга и инспектора сохранилась.

## 2026-09-28 — сравнение труб и видов со старым Saturn

Сопоставлены `90da21a:plant/routing.ts`, `src/geometry.ts`, `src/view.ts`,
`src/view3d.ts` и кадры `saturn/docs/evidence-runtime/editor-2d.png`,
`editor-3d.png` с кадрами текущего Bun host. У старого Saturn 2D-труба имела
обводку 26 px, оболочку 22 px, жидкость 17 px, скругление и moving highlight;
в текущей реализации до правки оставались обводка 12 px, жидкость 8 px и
highlight 3 px. В 3D до правки была одна бледная трубка радиуса 6 и частицы.

Восстановлены отдельные обводка/оболочка/жидкость/блик в 2D, скруглённая
визуальная ось при сохранении точной ортогональной модели маршрута, серое
состояние при отсутствии измерения. В 3D добавлены оболочка, внутренняя среда,
индикация потока и подписи оборудования; диагностическое сообщение об
отсутствующем экране перенесено в верхний угол и не закрывает резервуар.
Сетка ослаблена. Это визуальная доработка общего Shell, без изменения DSL,
топологии или физики.

- `bun test tests/pipe-path.test.ts tests/physical-interaction.test.ts
  tests/route3d.test.ts`: **18 PASS, 0 FAIL, 114 assertions**. В том числе
  100-кадровый диагональный drag и сохранение маршрута после drop.
- `bun test tests/physical-interaction.test.ts tests/route3d.test.ts
  tests/domain-contracts.test.ts`: **26 PASS, 0 FAIL, 111 assertions**.
  Проверены точные XYZ-порты, ортогональность, препятствия, стационарные
  коридоры и отсутствие фиктивного потока при закрытом клапане / stale.
- `bun scripts/pipe-visual-browser-test.ts`: **PASS** на настоящем Bun host и
  Chromium после итоговых правок. Проверены 2D-слои и rounded bend, 3D shell
  и liquid, видимые подписи, сохранение той же формы трубы при drop, корректная
  invalid-диагностика при намеренном пересечении оборудования и отсутствие
  ошибок страницы. Кадры `artifacts/pipe-before-2d.png`,
  `pipe-after-2d.png`, `pipe-before-3d.png`, `pipe-after-3d.png`,
  `pipe-blocked-2d.png`, `pipe-blocked-3d.png` визуально просмотрены.
- `bun run check`: **PASS**, TypeScript 7/6 и architecture guard 165 modules.

Визуальная и функциональная parity всего старого редактора не закрыта.
Старый `tap(line, instrument)` прикреплял прибор к секции трубы; новый
`mount: {pipe}` решает часть этой задачи в 2D/3D без буквального переноса API.
Старые приборы давления и температуры, полный набор их 2D/3D-моделей и
визуальные состояния на большом проекте требуют отдельной приёмки, прежде чем
заявлять «не хуже» в целом.

### Приборы в 2D/3D — 2026-09-28

Введён project-owned `InstrumentCapability` для циферблата, цифрового индикатора
и inline-расходомера. Для выносного прибора `mount: {pipe}` даёт авторское
крепление к существующей трубе; renderer проецирует штуцер на её текущий
маршрут после drag. Буквальный старый `tap(line, instrument)` и полный
каталог/размеры старых моделей всё ещё не перенесены.

- Bun 1.4.2: `bun test tests/instrument-presentation.test.tsx tests/core.test.ts
  tests/physical-interaction.test.ts` — **29 PASS, 0 FAIL, 65 expect**.
- Bun 1.4.2: `bun run check` — **PASS**, TypeScript 7/6 и architecture guard
  **167 modules**.
- Bun host + Chromium: `bun scripts/instrument-design-browser-test.ts` —
  **PASS**: живые показания трёх типов, 2 крепления к маршрутам, 2D/3D,
  подписи, узкий экран, 0 ошибок страницы. Кадры в
  `artifacts/instrument-design/diagram-2d.png`, `scene-3d.png`,
  `scene-3d-mobile.png` просмотрены. Это проверка небольшого инженерного
  проекта; визуальная приёмка полного каталога и больших станций остаётся открытой.
- Bun host + Chromium: `bun scripts/hmi-overview-browser-test.ts` — **PASS**:
  5 приборов используют тот же SVG в карточках операторского обзора; их
  детальный экран и отправка команды открываются; на 390×480 нет горизонтального
  переполнения. Кадры `artifacts/hmi-overview/overview-desktop.png` и
  `overview-mobile.png` просмотрены.
- Bun 1.4.2 в соседнем `saturn-examples`: `bun run --bun tsc -p
  chnpp4/tsconfig.json` — **PASS**; `bun test
  chnpp4/tests/operator-runtime.test.ts
  chnpp4/tests/emergent-auxiliaries.test.ts` — **7 PASS, 0 FAIL**.
- Bun host + Chromium: `bun scripts/chnpp4-instrument-browser-test.ts` —
  **PASS**: authored `AUX-TT` из `saturn-examples/chnpp4` виден в 2D,
  построен в 3D и показан в обзоре и детальном операторском HMI; 0 ошибок
  страницы. Кадры `artifacts/chnpp4-instrument/` просмотрены. Остальные 19
  моделей этого исследовательского стенда в 3D пока условные объёмы, поэтому
  этот тест не доказывает визуальный паритет всей станции.
- `git diff --check`: **PASS**.

Большой реальный проект старого формата и читаемость всех подписей в 3D ещё не
проверены. Browser drag подтвердил движение подложки и сохранение прямого
числового литерала; вычисленные позиции и конфликт внешнего изменения остаются
в общей приёмке two-way editing.
