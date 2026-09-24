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
  server.ts                # выбранный драйвер/симулятор
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

Это соглашения по назначению, не набор обязательных файлов для каждого устройства.
Для простого насоса достаточно одного файла. ПЛК может владеть каталогом с компилятором и HMI.
Импорты явные: директория не сканируется для скрытой активации плагинов. Секреты поступают
из окружения runtime, не попадают в Git или артефакт.

Тип оборудования определяется через один `device()` contract. `pump/tank/valve/plc` — обычные definitions, созданные тем же `device()`, что и vendor equipment; отдельного built-in registry нет. Порты, signal schema и diagram bounds принадлежат declaration и не дублируются в `geometry.ts`. Глобальный plugin manager для этого запрещён.

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
ошибок процесса и бесконечного пользовательского кода. До подключения реального объекта нужен
runtime-only host и отдельный процесс/worker authority, без загрузки рабочего исходника.
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
Browser Shell показывает постоянный проводник: папки и файлы строятся из настоящих
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

Project-owned equipment extends the model through `device()`. Every definition owns typed ports, signal defaults and declarative Diagram/HMI/Firmware/Emulator capabilities; instances remain ordinary Project equipment. Built-in and vendor definitions are indistinguishable to the core. There is no global plugin registry or activation lifecycle and the IDE must not branch on vendor IDs.

`autoHmi(controller)` stores intent only. `project()` derives the HMI equipment set from physical
topology, so connectivity is not authored twice. Firmware remains source-owned and target-defined:
C23, C/C++, Rust, Zig or another language are valid when the target supplies the corresponding toolchain.

The first reference kit is `saturn-plugins/saturn-plc500`: the real Saturn PLC SVG, pinned
Firmverse compiler/runtime WASM and the 320×240 React HMI projection are carried with provenance
and licenses from the previous Saturn implementation.


### AST as one source projection

Source tooling does not identify equipment by helper names such as `pump()` or `saturnPlc500()`. The shared parser recognizes the structural authored form `factory("ID", { x, y, ... })`. Resource indexing, two-way drag ranges and rename consume that same AST projection. It is derived from source and is never persisted as a second model.

## Repository ownership, 2026-09-24

- `saturn-ide`: reusable DSL, workspace, runtime, shell and local host. Its package
  exports core contracts, artifact, shell and host. No production import points
  at an example, vendor kit, Vercel or SaaS.
- `saturn-saas` (private): depends on a pinned IDE revision. Owns GitHub OAuth,
  encrypted browser sessions, GitHub transport, Vercel deployment and cloud UI.
- `saturn-examples`: authored object projects. `pumping-station` replaces the old
  embedded `project/`. It contains explicit imports and copied vendor source.
- `saturn-plugins`: canonical reusable source kits, including `saturn-plc500` and
  its unchanged Firmverse binaries and license/provenance files.

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
