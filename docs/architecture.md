# Архитектура Saturn IDE

Статус: **принятая структура и правила развития**. Это не заявление о завершённом переносе функций.
База сравнения: Pom4H/saturn `90da21a1885a72022b7a2d1b45cb36993bee1597`.
База новой реализации: saturn-ide `9be93be56bfb9ee6637d19c11273ea01c1d59b66`.

## Цель

Перенести лучшие решения Saturn, сохранив их возможности, и сократить число независимых
моделей, неявных состояний и мест изменения кода. Меньше функций — не улучшение архитектуры.
Новый функционал не считается заменой старого, пока не выполнен критерий в [матрице переноса](capabilities.md).
Отсутствующая возможность отмечается как незавершённый перенос, а не исчезает из требований MVP.

Одна типизированная модель физического объекта:

```
TypeScript project → Diagram / HMI / Runtime / History / Reports / PLC / Deployment
```

Файлы проекта — авторский источник. Проверенный BuildArtifact — производный результат,
не второй редактируемый формат. Наблюдения, команды, тревоги и журнал — состояние исполнения.
Shell связывает работу с ними, а не дублирует их модели.

## Структура кода продукта

```
src/
  core.ts                 # публичный DSL и контракты; стабильный @saturn/core
  core/artifact.ts        # проверяемый неизменяемый результат сборки
  topology.ts             # физические связи и общая маршрутизация
  motion.ts               # состояние визуального движения по наблюдениям
  reports.ts              # вычисление отчётов, независимое от UI/SQL
  protocol.ts             # DTO границы клиента и сервера
  source-edits.ts         # чистые операции по диапазонам исходника
  workspace/
    files.ts              # чтение/сохранение с проверкой версии
    language.ts           # TypeScript Language Service
    git.ts                # Git рабочего проекта
    build.ts              # source → проверка → BuildArtifact; никогда driver.start
  runtime/
    engine.ts             # наблюдения, качество, команды и тревоги
    store.ts              # SQL: SQLite/PostgreSQL
    events.ts             # доставка снимков/событий
    push.ts               # Web Push
    revisions.ts          # retained builds, published/applied, CAS
    decode-project.ts     # проверка модели после транспорта
    installation.ts       # автомат применения и восстановления
    project-installation.ts # владение драйвером, fencing устаревших callbacks
  host/
    dev.ts                # Bun HTTP и сборка приложения из модулей
    report-api.ts         # транспортный адаптер отчёта
  shell/
    app.tsx               # рабочие пространства, контекст, навигация
    editor.tsx            # поверхность исходников
    scene.tsx             # поверхность схемы
    scene3d.tsx            # 3D-проекция той же топологии
    symbols.tsx           # текущие SVG, без перерисовки в структурном рефакторинге
    reports.tsx           # поверхность отчётов
    controls.tsx          # операторские действия
    api.ts                # транспорт клиента
    styles.css            # единые визуальные токены
```

Отдельный пакет на каждую папку не нужен. Публичные чистые модули в корне `src` оставлены
на месте, чтобы не вводить слой совместимости ради косметического перемещения.
Назначение папок фиксировано. Новые каталоги создаются только вместе с работающим кодом.

### Направление зависимостей

- Чистые модули не импортируют Bun, React, Git, БД или TypeScript compiler.
- Workspace импортирует чистые модули; не владеет runtime и не вызывает драйверы.
- Runtime импортирует чистые модули и свои адаптеры; не читает рабочую копию, не импортирует
  Shell, Git или TypeScript Language Service и не вызывает Bun.build.
- Shell импортирует контракты и компоненты поверхностей, общается с runtime через API.
- Только Host собирает эти части вместе.

`scripts/architecture-check.mjs` проверяет границы импортов и запрещает явный `any`.
Тест границ не доказывает поведение, безопасность оборудования или визуальное качество.

## Структура инженерного проекта

Приложение Saturn и проект объекта — разные каталоги. Генератор проекта не должен копировать
исходники самой IDE, её тесты и инфраструктуру.

```
project/
  package.json             # обычный проект, без собственного manifest-протокола
  project.ts               # сборка единой модели обычными imports
  server.ts                # опционально: выбранный драйвер/симулятор
  signals.ts               # выносится только когда нужен
  systems/                 # группы/подсистемы объекта, по мере появления
  equipment/
    pump-unit/
      definition.ts        # сигналы, единицы, параметры, порты типового агрегата
      view2d.tsx           # SVG-представление
      view3d.ts            # 3D-представление
      tests/               # проверки конкретного агрегата
    plc-01/
      device.ts            # профиль и экземпляр ПЛК
      driver.ts            # реальный протокол/адресация
      hmi.ts               # представление тех же сущностей
      compiler.ts          # явная команда компиляции
      firmware/            # исходники целевого устройства
  reports/
    hourly-water.ts        # определение отчёта по тем же сигналам
  targets/                 # конфигурации сред и сборок, без секретов
  plugins/                 # прочие скопированные исходники
  assets/
  tests/
```

Новый пустой проект содержит только project.ts, package.json, tsconfig.json, README.md и .gitignore. Полная демонстрационная станция создаётся отдельно через `--template pumping-station`. `server.ts` и `browser.ts` добавляются только при необходимости.

Это соглашения по назначению, не набор обязательных файлов для каждого устройства.
Для простого насоса достаточно одного файла. ПЛК может владеть каталогом с компилятором и HMI.
Импорты явные: директория не сканируется для скрытой активации плагинов. Секреты поступают
из окружения runtime, не попадают в Git или артефакт.

Тип оборудования определяется через один `device()` contract. `pump/tank/valve/plc` и project-owned definitions создаются тем же `device()`; отдельного registry для специальных классов нет. Порты, signal schema и diagram bounds принадлежат declaration и не дублируются в `geometry.ts`. Глобальный plugin manager для этого запрещён.

## Source, checked, published, applied

```
рабочие файлы ── build/check ── проверенный artifact
                                   │
                              publish(expected)
                                   │
                              apply(expected)
                                   │
                          один runtime authority
```

Исходный Git HEAD, хеш рабочего содержимого, хеш сборки, published и applied различаются.
Сборка учитывает модель, bundled driver, source digest, Git HEAD (если есть), lockfile,
версию Bun и хеш доменного ядра. Timestamp не входит в идентичность артефакта.

`BuildArtifact` новой модели имеет **schema saturn.build@2**. Он не выдаётся за бинарно
совместимый старый saturn.build@1: старый и новый проект имеют разные формы. Миграция старого
проекта должна быть явной и проверять сохранение сущностей, связей, выражений и представлений.
Хеш подтверждает целостность, но не доверенность автора: driver bundle содержит исполняемый код.

Порядок перехода: проверить и подготовить кандидата → остановить прежнего владельца оборудования
→ запустить кандидата со staging наблюдений → CAS применённой ревизии → открыть доставку наблюдений.
Отказ подготовки не останавливает прежний драйвер. Отказ старта/записи состояния останавливает
кандидата и восстанавливает прежнюю установку. Неоднозначный отказ остановки означает faulted:
второй владелец оборудования не запускается. Ошибка уже после durable commit не маскируется
фиктивным откатом: applied указывает новую сборку, runtime показывает ошибку.

Совместимое изменение только представления не перезапускает драйвер. Physical connections,
сигналы и bundled driver входят в acquisition key; координаты схемы, via, отчёты и подписи — нет.
Отозванное поколение драйвера не может опубликовать запоздалое наблюдение. При повторном запуске
старые показания считаются stale до подтверждения.

Это восстановление программной конфигурации/соединения, **не отмена физических действий**.
Контракт драйвера требует освобождать ресурсы при rejected start или отмене. Host не может
универсально доказать, что сторонний драйвер остановил оборудование.

В dev допустим автоматический preview только заявленного доверенного симулятора и только
когда текущий runtime тоже не live. `SATURN_PREVIEW=manual` полностью выключает автоприменение.
Live-кандидат всегда требует явных publish/apply и записанного lockfile; live-команда — expectedApplied.

### Граница, которую ещё нужно закончить до эксплуатации

Сейчас dev-host всё ещё работает в одном процессе. Разделение импортов не даёт изоляции CPU,
ошибок процесса и бесконечного пользовательского кода. Runtime-only host `src/host/runtime.ts` теперь существует и проверен отдельным процессом;
он не загружает рабочий исходник. Изоляция текущего dev-host всё ещё не реализована.
Одна команда `bun dev` может запускать оба: это не требует микросервисов, брокера или оркестратора.
Отдельно нужны startup/restart/fault tests на реальном драйвере и выбранном deployment target.

## Shell — договорённость о работе, а не панель над демо

Постоянные контексты: **Project / Surface / Environment**. Рабочие пространства инженера и
оператора оба полноценны; операторское не требует дерева исходников. Simulation и Plant видны
постоянно. Source, checked, published и applied должны быть различимы без открытия логов.

Shell владеет навигацией, открытыми буферами и расположением панелей. Surface владеет локальным
взаимодействием: drag и камера схемы, редактор кода, настройка/предпросмотр отчёта. Runtime owns
наблюдения, команды, тревоги и их подтверждения. Не создаётся второй EventBus или model store для
каждой вкладки. Выбор сущности связывает её source, оборудование, сигнал, соединения, HMI и отчёты.

У browser Shell одна постоянная нижняя `ShellPanel` на уровне workbench, общая для всех
поверхностей. Оборудование, графики, терминал и уведомления — её вкладки. Состояния открытия,
вкладки, высоты и разворачивания принадлежат одному `panelReducer`; колокольчик, вкладки,
клавиатура и statusbar направляют действия туда. Surface не создаёт собственную нижнюю панель.
Сворачивание и смена Surface не размонтируют терминал и не теряют введённую команду/журнал.
История тревог загружается один раз через `useAlarmHistory` и передаётся обеим проекциям:
уведомлениям и терминалу. Квитирование остаётся командой runtime API; ошибка запроса не
превращается в локальное подтверждение. Инспектор занимает область поверхности над панелью.
Селектор проекта и его режим находятся в topbar, сайдбар содержит разделы и ресурсы.
Цвета всех поверхностей определены общими токенами `styles.css`, компоновка — `resources.css`.
Browser Shell показывает постоянный проводник с режимами Объекты / Значки / Список файлов / Папки. Первые два открывают предметные сущности и сохраняют полный доступ к исходникам в отдельной группе; остальные открывают файлы. Это вычисляемые проекции одного ResourceCatalog. Папки и файлы строятся из настоящих
`resource.source.path`, объявления устройств/отчётов остаются дочерними узлами своих файлов.
Несколько объявлений в одном файле не создают выдуманные файлы. Узлы без найденного исходника
помечаются отдельно. «Представления» — явная группа команд, а не часть файловой системы.
Клик по файлу всегда открывает исходник; действия устройства явно открывают схему или сигналы.

Схема и исходники — независимые вкладки в одной полосе. Source-вкладка идентифицируется путём
реального файла, схема — парой project/diagram; выбор другого прибора не создаёт вторую схему.
Вкладка восстанавливает своё представление. Переключение сохраняет порядок вкладок и черновики;
закрытие неактивной вкладки не меняет текущую. Защита от потери текста относится к исходнику:
закрытие схемы не отбрасывает и не требует сохранения открытого черновика. Последнюю вкладку
можно закрыть; telemetry/обновление каталога не открывают её заново. Split «Код рядом» удалён.
Документы по-прежнему имеют один общий буфер на путь, никакой второй модели проекта нет.

Текст chrome не выделяется; редактор и копируемые данные сохраняют selection. Подсветка
CodeMirror использует семантические CSS-токены обеих тем и меняется без пересоздания редактора
или потери черновика. Подсказки TypeScript используют те же токены подсветки и имеют
ограниченную высоту с прокруткой полного ответа language service.

Контекстные и выпадающие меню Shell используют один `MenuProvider` / `MenuButton`:
в каждый момент открыто одно меню, его положение ограничено viewport; Escape возвращает
фокус инициатору, стрелки выбирают действия, Shift+F10 открывает контекстное меню.
Проводник передаёт ресурс конкретной строки, вкладки — конкретную ResourceTab, нижняя
панель — действия существующего panelReducer. Меню не владеет документами или runtime.
Пакетное закрытие вкладок проверяет черновики до первой операции закрытия. Переходы
проекта и настройки вида используют тот же компонент; отдельный мобильный popup удалён.

При базовой миграции рендеры были сохранены; последующие изменения Shell проверяются в браузере. Выделение оставшегося состояния из большого App,
показ draft рядом с applied live-моделью и операции release непосредственно в Shell ещё не завершены.
Эти пункты — условия приёмки, а не необязательная полировка.

## Сильные решения, которые нельзя потерять

Вывод типов из определения проекта; вычисляемые сигналы и проверка физических размерностей;
единые ports/topology; реальные 2D/3D и phase continuity; canonical Presentation для разных HMI;
история/воспроизведение без отправки повторных команд; отчётные задачи и типизированные табличные
выходы; проверяемый deploy; source-owned equipment/targets; source-preserving two-way editing.

Не все эти функции уже перенесены. [Матрица](capabilities.md) связывает их со старым кодом,
владельцем в новой структуре и проверкой. Готовность новой архитектуры означает закрытие этих
проверок, а не только зелёный typecheck или меньшее число файлов.


## Equipment definitions

Project-owned equipment extends the model through `device()`. Every definition owns typed ports, signal defaults and declarative Diagram/HMI/Firmware/Emulator capabilities; instances remain ordinary Project equipment. All equipment definitions are indistinguishable to the core. There is no global plugin registry or activation lifecycle and the IDE must not branch on extension-specific IDs.

`autoHmi(controller)` stores intent only. `project()` derives the HMI equipment set from physical
topology, so connectivity is not authored twice. Firmware remains source-owned and target-defined:
C23, C/C++, Rust, Zig or another language are valid when the target supplies the corresponding toolchain.


### AST as one source projection

Source tooling does not identify equipment by helper names such as `pump()` or a project-defined factory. The shared parser recognizes the structural authored form `factory("ID", { x, y, ... })`. Resource indexing, two-way drag ranges and rename consume that same AST projection. It is derived from source and is never persisted as a second model.

## Repository ownership, 2026-09-24

- `saturn-ide`: reusable DSL, workspace, runtime, shell and local host. Its package
  exports core contracts, artifact, shell and host. Production code does not import
  examples, source-kit catalogs or cloud infrastructure.
- cloud/integration layers depend on a pinned IDE revision and own authentication,
  remote transports, deployment orchestration and cloud UI outside this repository.
- `saturn-examples`: authored object projects with explicit imports and copied
  project-owned extension source when required.
- reusable source kits live outside the IDE repository and carry their own implementation,
  provenance, licenses and acceptance tests.

A trusted local project can export browser display factories from `browser.ts`.
The host bundles this explicit entry and supplies its factories to Shell. It
also bundles a project without this entry, using generic displays. The IDE no
longer imports a concrete PLC display. Project browser source changes are
rebundled; reload the browser to load the new renderer. Runtime observations and
normal source edits continue through existing SSE/preview behavior.

Integration tests deliberately use sibling examples/plugins checkouts; these
are test inputs, not production IDE dependencies. `SATURN_PROJECT` selects the
local engineering project; the development convenience default is the sibling
`saturn-examples/pumping-station`. Core and runtime remain usable independently.
Cloud source authoring does not run an arbitrary repository in the OAuth server.
Remote runtime execution and physical PLC flashing remain separate acceptance
criteria; a deployment plan alone does not fulfill them.

Standalone runtime deployment is described in [runtime-deployment.md](runtime-deployment.md).
Industrial protocol kits are owned by `saturn-plugins/protocols`; the IDE tests
use that repository as an external fixture. `src/host/runtime.ts` composes only
runtime and core modules and accepts checked artifacts through role-scoped APIs.

### SaaS access and scenario orchestration (2026-09-24)

SaaS authenticates one GitHub identity for engineering and operator views. Project-scoped
capabilities are checked by its server, including source, CI, runtime reads, commands and
alarm acknowledgements. The runtime accepts only gateway service credentials; each control
request carries expectedApplied and shares the apply queue, so a build transition cannot
race a command accepted for another build. Shell visibility is never the security boundary.
GitHub remains repository authority: a Saturn policy cannot remove direct GitHub access.

Workflow SDK is optional project-owned scenario orchestration, outside core and runtime.
Scenario helpers take existing typed Signal references. A durable workflow coordinates
simulation stimuli and measured assertions; the selected execution backend owns its cycle in a separate
process. Neither saving source nor retrying a workflow deploys or flashes a PLC.

### Operator feedback → authored DSL proposal

Feedback belongs to SaaS identity/Git integration. AI Gateway receives the operator request
and a bounded catalog of existing DSL literals, never runtime/deployment credentials or a
shell tool. It returns typed DslChange operations. Workspace owns AST targeting and literal
serialization. Supported operations initially cover equipment localized labels, existing
signal initial values and existing alarm thresholds; unknown targets and computed/spread
forms are rejected. This is an extensible operation contract, not another project DSL.
The resulting draft PR is unverified authored source until ordinary project CI checks it.
It cannot merge, publish, apply, flash, edit CI/permissions/dependencies or run generated code.
Operator notes can be recorded as issues without generating source. Capability checks and
GitHub repository authority apply independently; lack of GitHub push permission cannot be
worked around by using another user's OAuth credential.

## Ассистент shell

Ассистент — вкладка существующей ShellPanel. Диалог и локальный разбор загруженного
архива не создают второго проекта или authority. Переключение инженер/оператор —
представление; права SaaS проверяет сервер. `AssistantService` передаётся в local host
композицией; IDE не зависит от SaaS, GitHub/OAuth или AI Gateway. Без адаптера показывается
явное отсутствие AI, а разбор файлов работает. Общий React-компонент экспортирован для SaaS.

История диалога хранится в sessionStorage на проект и identity; это история вкладки
браузера, не долговременный многопользовательский журнал. Архив не сохраняется там.
ZIP разбирается локально с лимитами 32 МБ входа, 64 МБ распаковки, 8 МБ на файл,
1000 записей и проверкой путей. Это ограниченный локальный разбор вложения, не доказательство успешной миграции. Содержимое
формат-специфических проектов обрабатывается только подключённым importer; core не знает их
секций, скриптов, адресов или других соглашений.

SaaS владеет AI Gateway, авторизацией, адресатами и публикацией заметок. Обычный ответ
не вызывает внешних записей. Кнопка публикации заметки — отдельное явное действие.
Модель не получает инструменты runtime-команд, shell, изменения CI, прав, зависимостей
или прошивки. Предложения DSL проходят отдельную границу workspace/AST, review и CI;
ответ в чате не является checked artifact. Формат-специфическая миграция и создание PR из ассистента не входят в core; такие возможности
подключаются через явные importer/integration boundaries.


## Importers as extension boundary

External SCADA formats are not part of the Saturn domain model. Saturn exposes only the
`ScadaImporter` source contract. An importer source kit may parse its input and produce
ordinary authored Saturn TypeScript plus diagnostics. The project opts in explicitly from
`browser.ts`; the IDE does not maintain a global importer registry.

```text
legacy SCADA files
        ↓
project-owned importer source kit
        ↓
ScadaImportPlan
        ↓ explicit review/apply
Saturn TypeScript → normal check/Git/publish/apply
```

Generated files are confined to `imports/<importer-id>/`. Import changes source only:
the applied runtime is unchanged until the normal publish/apply lifecycle. Presentation
elements reference canonical Saturn signals; they are not modeled as fake equipment.

## Infrastructure is an observation source

The Performance surface consumes canonical Signal/Sample quality and bounded
history windows. Local OS/process instrumentation remains a project-owned source
kit, composed through defineProtocol/acquire. The runtime exposes read-only
inspection independently of SQL; inspection never generates another measurement.
No separate authored infrastructure model or plugin registry exists. See
[infrastructure.md](infrastructure.md) for contracts, UI, accounting and limits.

### Общее ядро команд Shell

`src/shell/model/commands` владеет каталогом команд, разбором/дополнением ввода,
историей и последовательностью клиентских действий. `CommandBar` (DOM),
`CommandTerminal` (OpenTUI) и `host/cli` (JSON/batch) используют один движок.
Добавление команды требует реализации в общем ядре, не отдельного parser в renderer.
Прежний локальный regex-dispatch из `shell-terminal.tsx` удалён.

Движок получает существующие `ShellSession`/`Documents`, server snapshot и transport
port. Он не создаёт Project/Signal/Topology, не импортирует compiler/workspace/runtime
и не становится authority. AST-каталог остаётся производной workspace, TypeScript
completion запрашивается у Language Service; source insert редактирует общий черновик.
Runtime команды получают expectedApplied. Сохранение, публикация и применение остаются
разными операциями; существующая политика simulator preview не меняется.

AI получает ограниченную проекцию выбранного объекта, AST-метаданных и applied
наблюдений через composing host. Ответ не является командой или проверенным исходником.
Внешние агенты читают общий каталог и структурированные результаты через CLI.
Существующие графические поверхности и их контроллеры ещё не полностью перенесены
на это ядро: завершён общий путь командных оболочек, не заявлена полная parity IDE.
Синтаксис, границы и варианты запуска описаны в [command-shell.md](command-shell.md).

## Исполняемый IDE и задания (2026-09-25)

`host/application` выбирает GUI/serve/CLI/TUI/worker над существующими модулями.
`host/payload` распаковывает versioned IDE payload с embedded Bun; `host/standalone` — entry portable Windows-сборки. Авторский проект не
получает реализацию IDE. Manifest выпуска общий для website downloads и sidebar updates.
Git сохраняет workspace ownership: structured DAG, fetch/ff-only main и reviewed restore
новым scoped commit. Это не runtime apply.

`workspace/job-source` готовит exact-commit worktree и загружает обычный authored
DeploymentPlan. Workflow SDK в SaaS владеет durable DAG; `host/worker` исполняет
конкретные шаги в Bun Workers. `runtime/jobs` хранит идемпотентные execution receipts,
не создаёт другой язык workflow. Report jobs читают applied BuildArtifact и архив через
`runtime/report`, тот же путь агрегации используется интерактивным отчётом.

`ProjectInstallation` присваивает наблюдениям immutable TelemetryRun только от реально
активированной сборки. Архив хранит build/source commit/run/mode/start; source branch
показывается как подсказка навигации. A/B сравнивает retained build contracts по semantic
signal ID, сохраняя пропуски и покрытие. Старые строки не получают выдуманную provenance.
Подробности и ограничения: [delivery-and-jobs.md](delivery-and-jobs.md).

### Типизированные отчёты и экспорт

`core/reporting` расширяет существующий report() SQL/schema/workbook-вариантом.
`runtime/report` владеет согласованным снимком истории и durable результатом,
`runtime/report-query` исполняет SELECT в одноразовом процессе, `runtime/report-xlsx`
создаёт настоящий OOXML. Shell/CLI и Workflow SDK используют эти результаты через
host. Скачивание по artifactId не перечитывает историю. Миграция и границы паритета:
[report-migration.md](report-migration.md).
