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
  core/project-codec.ts   # восстановление ссылок Signal после JSON-транспорта
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
    decode-project.ts     # совместимый импорт общего core decoder
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
- Shell восстанавливает ссылочную идентичность `Signal` в транспортной копии через
  `core/project-codec.ts` перед полной проверкой совместимости порта. Это тот же
  `Project` и тот же `validateProject`, без отдельной клиентской модели связей.
- Только Host собирает эти части вместе.

`scripts/architecture-check.mjs` проверяет границы импортов и запрещает явный `any`.
Тест границ не доказывает поведение, безопасность оборудования или визуальное качество.

## Структура инженерного проекта

Приложение Saturn и проект объекта — разные каталоги. Генератор проекта не должен копировать
исходники самой IDE, её тесты и инфраструктуру.

Инженерные примеры принадлежат отдельному репозиторию `saturn-examples`.
Конкретный состав установки, модели оборудования и физики, начальные условия,
2D/3D-представления, анимации и сценарии принадлежат проекту примера. Ядро расширяется
общими контрактами; оно не выбирает поведение по имени/ID примера и не содержит
его таблиц оборудования или параметров. Специализированное оборудование подключается
обычными imports проектных расширений. Проверка достоверности конкретного двойника
принадлежит примеру и отделена от проверки общих возможностей Saturn.

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

Новый пустой проект содержит только project.ts, package.json, tsconfig.json, README.md и .gitignore. Полная демонстрационная станция создаётся отдельно из явно указанного внешнего example source (`--template pumping-station --example <path>` или `SATURN_EXAMPLE`); IDE не предполагает соседний checkout `saturn-examples`. `server.ts` и `browser.ts` добавляются только при необходимости.

### Первый запуск и выбор проекта

`host/application.ts` открывает обычный `createApp`, если выбранная папка содержит
`project.ts`. Для `gui` без проекта Host поднимает локальное окно создания,
открытия и клонирования; `serve` по-прежнему требует существующий проект.
`host/project-launcher.ts` владеет только HTTP-сессией выбора и открытыми host-ами.
Он использует тот же `createApp`, переиспользует уже открытый каталог и закрывает
его вместе с launcher. Неудачная сборка браузерного расширения завершается до
создания runtime и запуска драйвера. `launcher/` содержит статические HTML/CSS/JS
этого окна и не вводит отдельный клиентский Project.

`workspace/project-launcher.ts` отвечает за проверки путей, поиск `project.ts`
и работу локального Git. Поиск не исполняет исходники. Клонирование использует
отдельную временную папку и никогда не сливает файлы с существующей папкой
назначения. Создание внутри Git worktree сохраняет его корень и `origin`; вне
репозитория создаёт Git с веткой `main`, если Git установлен. Его отсутствие
не мешает создать и открыть локальные исходники; существующая Git-поверхность
показывает необходимость установки для истории и подключения. Список недавних проектов хранит только
пути, без копии модели, токенов или параметров подключения. Результат последнего
завершённого клонирования остаётся в памяти текущей сессии launcher, чтобы
обновление страницы не теряло выбор проекта.

Чистый `workspace/project-template-files.ts`, экспортируемый как
`saturn-ide/project-template`, формирует один и тот же набор авторских файлов для
локального и облачного создания. Файловый адаптер остаётся в Workspace, GitHub
адаптер — в Saturn SaaS. Облачное сохранение не исполняет исходники и не создаёт
дополнительный runtime. Пустой проект открывается и проверяется компилятором IDE
без предварительного `bun install` внутри проекта.

Это соглашения по назначению, не набор обязательных файлов для каждого устройства.
Для простого насоса достаточно одного файла. ПЛК может владеть каталогом с компилятором и HMI.
Импорты явные: директория не сканируется для скрытой активации плагинов. Секреты поступают
из окружения runtime, не попадают в Git или артефакт.

Тип оборудования определяется через один `device()` contract. `pump/tank/valve/plc/tee` и project-owned definitions создаются тем же `device()`; отдельного registry для специальных классов нет. Порты, signal schema и diagram bounds принадлежат declaration и не дублируются в `geometry.ts`. Глобальный plugin manager для этого запрещён.

Физические системы объявляются в том же авторском `project.ts` через `system(id, label, parent?)`;
экземпляр оборудования ссылается на систему через `system` в параметрах `device()`.
Иерархия проверяется вместе с Project. Границы групп в 2D/3D вычисляются из
координат и размеров оборудования в `core/system-layout.ts`, поэтому drag меняет
подложку без второй редактируемой модели. Группа не является оборудованием,
сигналом или отдельной симуляцией. Группы мониторинга определяют другой срез
тех же сигналов и не подменяют физическую принадлежность.

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
Среда исполнения и сценарии запоминают собственную компоновку той же панели и
при первом открытии оставляют её свёрнутой; возврат в обычную рабочую область
восстанавливает её вкладку/размер. Все действия проходят через общий panelReducer.
История тревог загружается один раз через `useAlarmHistory` и передаётся обеим проекциям:
уведомлениям и терминалу. Квитирование остаётся командой runtime API; ошибка запроса не
превращается в локальное подтверждение. Инспектор занимает область поверхности над панелью.
Селектор проекта и его режим находятся в topbar. Узкая рейка выбирает рабочую область,
контекстный сайдбар показывает ресурсы выбранной области, центральная Surface остаётся
смонтированной при открытии правых Details или Review. Активная область выводится из
`ShellSession.navigation.surface`; второй независимый rail-state запрещён. Для оператора
«Среда» показывает статус и отдельные Source Git / Checked / Published / Applied без
редактирования плана. Это ограничение интерфейса не заменяет авторизацию API.
Цвета всех поверхностей определены общими токенами `styles.css`, компоновка — `resources.css`;
размеры и состояния Shell описаны в [визуальной системе](design-system.md).
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

### Browser shell: task and tools — 2026-09-30

Инженерный shell по умолчанию открывает основной 2D-вид объекта с переключением
в 3D. Рейка выбирает отдельную центральную страницу: объект, код, мониторинг,
отчёты, Git, среда или плагины. «Код» всегда показывает файловую проекцию;
«Объект» — предметную. Один MenuProvider обслуживает единое меню проводника.
Чат и поддержка находятся внизу рейки; только эта страница показывает черновик
задачи и соседний выезжающий workbench. Инспектор/review принадлежат одному
правому слоту shell, соседнему с workspace, а не вложенному sidebar поверхности.

Вкладки ресурсов по-прежнему принадлежат ShellSession; «Новая вкладка» — временный
выбор инструмента над тем же workbench, без второго ResourceCatalog. Закрытие
правой панели на странице чата делает её inert и скрывает компоновку, но не
размонтирует поверхность, редактор, 3D canvas или единственную ShellPanel.
При небольшом viewport инструменты и инспектор открываются поверх центра.
Operator сохраняет полноразмерный workbench.

URL сериализует навигационную проекцию: страницу/инструмент, URI ресурса/путь
файла, выбранное устройство/сигнал/отчёт, 2D/3D и камеру, систему, режим рабочего
места, вкладку нижней панели, inspector/review и стартовую вкладку инструментов.
Reload и Back/Forward восстанавливают эту проекцию через тот же ShellSession;
перемещение камеры заменяет текущую history entry. URL не содержит черновик
исходника/запроса, данные исполнения, credentials и команды publish/apply.
Локальные настройки внутри отдельных поверхностей, не перечисленные в этой
проекции (например фильтры диагностики и период отчёта), пока не сериализуются.

Плагины — центральный каталог исходников текущего проекта с поиском, добавлением
из GitHub, закреплёнными ревизиями и проверкой обновлений через существующий
workspace API. Источник подключается обычным import; перечень файлов строится
из того же ResourceCatalog. Глобального lifecycle/реестра установки нет.

Кнопки chrome открывают одну общую панель инструментов и отдельную краткую сводку.
Сводка читает реальные Git/release данные и показывает отсутствие связи/ошибку,
не создаёт applied identity. Меню задач используют существующий MenuProvider;
меню файлов и вкладок продолжают выполнять команды того же ShellSession.

Список инженерных задач — только временные UI-черновики текущего открытого shell:
название, текст запроса, закрепление и обратимый архив в памяти. Это не история
разговора агента, база проектов или новый авторский формат. Перезагрузка страницы
сбрасывает эти черновики. Браузерный ACP transport подключает внешний процесс, явно заданный локальным
host через SATURN_AGENT_COMMAND. UI передаёт ограниченный project context из
общего CommandShell, показывает поток ответов/инструментов и стандартные запросы
разрешения, позволяет остановить запрос и отключить процесс. Без конфигурации
остаётся копирование запроса. CLI ACP также сохранён; модель, auth и tool loop
принадлежат агенту. Текст ответа и connection handles хранятся только в памяти
открытого Shell; долговременная история остаётся у внешнего harness.
Share/Fork/schedules и произвольный браузер URL не имитируются стартовой вкладкой.

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
local engineering project; examples are supplied explicitly by integration scripts or `SATURN_EXAMPLE`/`SATURN_DEMO_ROOT`;
production source has no implicit sibling-repository lookup. Core and runtime remain usable independently.
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

Workflow SDK is optional project-owned orchestration, outside core and runtime.
For bounded simulation sequences, `core/scenarios` supplies typed Signal-based
commands, waits and measured assertions inside the existing Project/BuildArtifact.
The report worker host executes these checked sequences in a Bun Worker through the
runtime-only simulation API; it never reads a changed working source to execute a job.
Runtime owns the actual driver and fences every command by applied build and telemetry
run under the apply queue. Live drivers cannot receive scenario commands. The selected
simulation backend owns integration time. The runner has explicit wall-clock waits
and opt-in fixed model steps with clock compare-and-swap; checkpoint replay/reset
remain unfinished. Dev Shell calls a same-origin gateway to the same worker and
runtime authority, without exposing worker credentials. Neither saving source nor retrying
a completed job deploys, flashes a PLC or repeats its commands.
See [runtime scenarios](runtime-scenarios.md) for the API and interruption semantics.

### Operator feedback → authored DSL proposal

Авторский `project()` допускает отсутствие пустых `equipment`, `pipes`, `alarms`.
Конструктор материализует отдельные массивы до обычной валидации; checked/transported
Project сохраняет прежний контракт. `null` и неверные коллекции не становятся defaults.
Статически известные сигналы индексируются по собственному ID с сохранением value type
и writable из оборудования, связей, тревог, отчётов, мониторинга, сценариев и HMI.
Условные ветки и неизвестный состав коллекций требуют проверки наличия; никакой
параллельный registry не добавляется. Helpers сохраняют типы переданных ссылок.
Standalone starter всё ещё закреплён на предыдущей опубликованной core-ревизии и
сохраняет совместимые пустые списки до отдельного обновления dependency pin.

Feedback belongs to SaaS identity/Git integration. AI Gateway receives the operator request
and a bounded catalog of existing DSL literals, never runtime/deployment credentials or a
shell tool. It returns typed DslChange operations. Workspace owns AST targeting and literal
serialization. Supported operations initially cover equipment string labels (without a locale), existing
signal initial values and existing alarm thresholds; unknown targets and computed/spread
forms are rejected. This is an extensible operation contract, not another project DSL.
Old locale-map labels remain explicit compatibility targets: a proposal must name the
existing locale and cannot silently replace or merge translations. Structural device
declarations use the same AST recognition as the source index; an explicit semanticId
is not required merely to change a name. Authored names/descriptions are plain strings;
Shell localization and system diagnostics do not impose translations on project source.
The resulting draft PR is unverified authored source until ordinary project CI checks it.
It cannot merge, publish, apply, flash, edit CI/permissions/dependencies or run generated code.
Operator notes can be recorded as issues without generating source. Capability checks and
GitHub repository authority apply independently; lack of GitHub push permission cannot be
worked around by using another user's OAuth credential.

## AI agents: external harness, Saturn context

Saturn IDE does not own an LLM agent runtime, model gateway, authentication flow, conversation
history or agent-specific tool loop. Those concerns belong to Codex, Claude Code and other external
agents.

The IDE integration boundary is stable ACP v1 through the official TypeScript SDK. An external
agent is a child process rooted at the current project, with its own auth/model/config. Ordinary
file edits need no Saturn-specific protocol: the existing workspace watcher, build and projection
pipeline observes the same TypeScript files. Saturn must not add an agent-specific workspace,
AST, file store or conversation database.

Saturn remains responsible only for engineering semantics: typed project source, resource identity,
inspection/impact, revision lifecycle and runtime authority. MCP is optional and only exposes
existing derived Saturn semantics when that is more useful than reading source; it is not required
for normal source editing. Do not implement a private JSON-RPC layer, agent registry or model gateway.

The local browser adapter (`host/agent.ts`) uses the same official ACP SDK and standard
stdio transport. The browser cannot supply an executable, cwd, environment or model.
Local host configuration selects the command; each transient task connects an external
session rooted at the existing workspace. Mutating transport endpoints require the
existing same-origin/session-key checks. ACP permission choices are relayed explicitly;
Saturn does not manufacture approvals. Cancellation, process failure and disconnect are
visible; host shutdown closes agent processes. These are local transport boundaries,
not authenticated remote agent access or runtime authorization.

External agents may propose source edits, but check, review, Git, publish and apply remain distinct.
An agent connection never implies runtime credentials, live commands, flashing or deployment
authority. Importers remain project-owned extensions and do not depend on an AI surface.

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
Copied project plugins may export `monitor()` declarations over canonical numeric
signals. `project.ts` imports them explicitly into `Project.monitoring`; the checked
artifact stores plain conditions, not callbacks. A pure projection evaluates limits
and freshness from runtime observations for the Performance surface. These read-only
health conditions do not create `Alarm` events or change acquisition policy. See
[monitoring-plugins.md](monitoring-plugins.md).
Per-signal `exchange` and `storage` requirements remain on the authored Signal,
independent of monitoring groups. Selective channel polling requires an explicit
plugin capability; archive selection never filters the live Snapshot or alarm
evaluation. SQL rows store their expiry when written, so later Project changes do
not reinterpret old retention. See [signal-data-policy.md](signal-data-policy.md)
for profiles, bounds and report/ML limits.

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

## Общий исполнитель расчётов оборудования — 2026-09-28

`@saturn/core/calculations` предоставляет `FixedStepCalculations`: фиксированный
шаг, один предыдущий снимок для входов всех узлов, отдельный расчёт следующего
состояния и общая фиксация кадра. Проект передаёт обычными imports свои
initialize/advance/observe и bindings внутри Driver; нового Project/Signal/Topology
или registry нет. Формулы, параметры, состав объекта и таймер принадлежат проекту.
Модуль входит в coreHash. Это перенос механики шага, не всего прежнего Kernel:
PLC compiler, port bindings, derived evaluator и checkpoint ABI остаются открытыми.

## Общий визуальный контракт приборов — 2026-09-28

Project-owned `device()` может объявить `capabilities.instrument` с формой
`dial`, `digital` или `inline` и числовым полем сигнала того же оборудования.
Один контракт управляет SVG-схемой, пространственной моделью и карточкой
обзора операторского HMI; детальный HMI использует ту же SVG-схему. Они
показывают наблюдение, его единицу и состояние свежести. Для выносного прибора
`mount: {pipe: id}` указывает существующую авторскую трубу. Shell вычисляет
точку отвода из текущего маршрута, поэтому крепление следует за drag и
не создаёт второй topology model или соединение для физики. `inline` требует
входной и выходной fluid-порты и устанавливается обычными `pipe()`.
Старый `tap(line, instrument)` остаётся отдельной задачей миграции API.

## Home, настройки и пресеты интерфейса — 2026-09-30

Home — проекция существующего `ShellSession` и той же модели объекта. По умолчанию
открывается реальный 3D renderer; 2D доступен рядом и как персональная настройка Home.
Ресурсные страницы продолжают занимать центр, чат — отдельную страницу с соседними
инструментами. Настройки используют sidebar Shell и центр, без вложенного explorer.
Язык, системная/светлая/тёмная тема, акцент, иконка Home и домашний/деловой пресет
сохраняются в браузере. Пресеты меняют меню и быстрые переходы, не тип Project и не
права. Домашний проект может обслуживаться бизнес-командой.

Навигация назад/вперёд использует native History с собственными индексами entries.
Выбор страницы/ресурса записывает entry, движение камеры заменяет текущий. Кнопки
не уводят на неизвестную внешнюю предыдущую страницу; browser Back остаётся нативным.
Home и раздел настроек сохраняются в URL. Несохранённые source buffers остаются
в Documents при переходе в Home/Settings. Перечитать изменённый файл можно в его
локальном заголовке; глобальная нижняя statusbar убрана. Git, runtime authority,
checked/published/applied, diagnostics и фоновые панельные возможности сохранены.

Индикатор среды показывает подтверждённое состояние подключённого runtime. Live
не переименовывается в production: необходима явная идентичность среды. Иконка
подготовки версии показывается независимо от исполнения при несохранённых/Git
изменениях или различии checked/applied. Сводка сохраняет раздельные идентичности.
Одновременный обзор нескольких runtime требует отдельного gateway с актуальными
наблюдениями каждого; текущий локальный host сообщает одну среду.

Первое открытие предлагает домашний и деловой пресеты. Демопроекты принадлежат
`saturn-examples/smart-home` и `saturn-examples/pumping-station`. Кнопка демо явно
создаёт отдельную копию обычного TS-проекта под dataDir и открывает отдельный local
host с declared simulator. Текущий проект не заменяется. У parent host ограничено
два demo hosts, они закрываются вместе с ним; из demo host нельзя рекурсивно
создавать новые hosts. Доступность определяется реальным наличием исходного примера
(`SATURN_DEMO_ROOT`), а не фиктивной карточкой. Standalone binary без этих внешних
примеров сообщает недоступность. CLI init/scaffold также принимает `smart-home`.

## Site/Space, CAD и совместные представления — предложение, не реализация

Один Project представляет инженерный объект; начальное пространство — абстрактный
корень Project, который не требует создания комнаты, размеров здания или CAD.
Home показывает объект целиком. Декомпозиция появляется по необходимости: площадка,
сооружение, этаж, помещение, зона. Физическая принадлежность не должна менять ID
оборудования, Signal или адреса протокола. Пользователь может одновременно видеть
пространственное дерево и независимую технологическую/мониторинговую группировку.

Существующие `System`, `project.systems` и `equipment.system` уже задают иерархию.
Перед расширением требуется уточнить семантику физического containment и вторичных
групп. Предлагается расширить этот же контракт типом пространства и пространственными
метаданными, а не заводить альтернативные Project/Equipment/Topology. Удобный
`space(id, options)` может возвращать расширенный System. Названия ниже — проект API,
не доступные сейчас exports:

```ts
const kitchen = space('kitchen', {
  label: 'Кухня', kind: 'room', parent: floor,
  placement: { frame: floor, translation: [4, 0, 0], rotation: [0, 0, 0, 1] },
  geometry: cad.entity('building-model', 'stable-external-element-id'),
});
```

`frame`/`parent` в удобном API могут принимать типизированный объект с сохранением
его ID в проверенной модели. Нужны проверки циклов, единиц, конечных transforms,
существования ссылок и provenance. Геометрия — asset/reference того же authored
проекта; runtime не загружает CAD source и не исполняет CAD SDK.

Текущие x/y/z участвуют в SVG schematic layout и 3D rendering с его собственным
масштабом. Их нельзя объявить миллиметрами задним числом. CAD integration требует
явно отделить схематическое размещение от физического transform. Преобразование
единиц и осей задаётся один раз на границе импорта; исходная система координат и
оригинальный файл сохраняются. Большие геодезические координаты требуют локального
origin и отдельной привязки, а не бесконтрольного масштабирования оборудования.

Форматы/адаптеры: IFC для пространственной структуры и внешних ID; STEP для точной
CAD-геометрии/сборок; glTF/GLB как производная визуализация для браузера. Наличие GLB
не подтверждает электрические/физические порты, управляющие сигналы или геометрическую
точность. Прямые коннекторы инженерного ПО, включая возможный Speckle adapter,
принадлежат project-owned source kits с обычными imports. Выбор конкретного SDK
и поддерживаемых версий требует проверки адаптером и его тестами.

Повторная синхронизация должна иметь `preview → review → source edit` поверх
workspace ownership. Текущий ScadaImportPlan создаёт новые TS-файлы и не умеет
обновлять уже импортированные файлы; синхронизация/двоичные assets пока не реализованы.
Нужен расширенный import plan с source revision/hash, стабильным ключом документа
и external entity ID, таблицей сопоставления с существующими entity IDs и per-field
ownership. Content hash версии не должен служить ID сущности. Сравнение трёх сторон:
прошлый импорт, новый CAD, локальные изменения. Коллизии ручных override и CAD
показываются явно. Удаление CAD-элемента оставляет диагностику привязки до review,
а не удаляет оборудование и историю. CAS защищает source от изменений после preview.
Импорт никогда не делает publish/apply или flashing. Assets и provenance хранятся
рядом с обычным TS source, без скрытого глобального installation DB.

Сценарий ЖК: одна площадка может ссылаться на самостоятельные Projects квартир,
дома и общих инженерных систем. Такая ссылка сохраняет Project ID и доступную
версию, не копирует сигнал в другую модель и не позволяет одному workspace
незаметно редактировать другой. Агрегированный view получает данные через
авторизованный server gateway; ссылки между проектами и multi-runtime federation
требуют реализации, их текущая local IDE не предоставляет.

Жилец и инженер открывают разрешённые представления одного объекта. Персональный
пресет влияет на меню, иконки и тему. Общая ссылка задаёт view/space/device/camera;
доступ определяется серверной identity и capabilities. Сам URL не выдаёт права и
не содержит секретов. Нужны отдельные разрешения просмотра, управления, редактирования,
публикации/деплоя и предоставления доступа. Operator mode не является авторизацией.
До появления authenticated sharing API нельзя показывать работающий “Share access”.
Скопировать ссылку на локальный вид уже можно, но это не удалённый общий доступ.

Первичные источники для проектирования адаптеров:

- IFC spatial decomposition/placement/GlobalId: https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcSpatialStructureElement.html
- glTF 2.0 coordinate/asset specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- Available engineering connector families, not a Saturn integration claim: https://docs.speckle.systems/connectors/manual-installation/introduction


## Scheduled для объекта — предложение, не реализация страницы

Один пункт «Расписание» открывает центральную страницу с ближайшими запусками,
активными задачами и историей результатов. Создание начинает с выбора «Отчёт»,
«Программа объекта» или «Развёртывание версии»; проект, timezone, следующая дата и
среда исполнения показываются до сохранения. Настройки расписания принадлежат
исходникам/проверенной версии проекта, а состояние запусков и результаты — runtime.
Домашний пресет может показывать «Автоматизации», деловой — «Расписание», с теми же
типизированными задачами и ID. Это разные подписи/быстрые фильтры одного view.

Отчёты опираются на существующие typed report definitions и runtime scheduledReports:
пропуски/coverage, timezone, dedup слотов и отсутствие неявного backfill сохраняются.
Программа объекта должна ссылаться на проверенную программу/команду и ограниченный
runtime contract, а не содержать свободный shell command из браузера. Существующий
scenario worker предназначен для симуляции; это не доказательство поддержки
периодической программы на физическом объекте. Нужны execution identity, запрет
перекрывающихся запусков, timeout/cancellation, retry policy и журнал результата.

Запланированный deploy привязывается к конкретной Published identity и целевой среде,
а не к текущему Git HEAD на дату запуска. Окно обслуживания и серверное право на
развёртывание проверяются при создании и повторно перед запуском. Ошибка/пропущенное
окно, смена Applied после согласования, pause/resume/cancel и failed-after-commit
должны быть видны в UI. Отсроченный deploy и общий scheduler этих программ пока
не реализованы; существующие worker jobs не следует переименовывать в готовую функцию.

Для общего интерфейса ЖК предлагаются разрешённые view definitions одного Project
и серверная выдача доступа конкретным пользователям/командам. Отдельные API для
создания/отзыва доступа должны отделять view, command, source edit и deploy rights.
«Показать этот вид» копирует обычный адрес, «Предоставить доступ» меняет ACL на сервере.
Пресет и факт нахождения дома внутри Site не должны сами предоставлять права.


## Официальные UX references OpenAI — проверены 2026-09-30

Референсы расположения кнопок/переходов — предоставленные скриншоты desktop app.
Документация проверена отдельно; страницы ниже описывают продуктовые сценарии,
а не спецификацию размеров или свидетельство визуальной parity Saturn.

- [Projects and chats](https://learn.chatgpt.com/docs/projects?surface=app): проект
  собирает связанный контекст, разговоры и файлы. В Saturn первичен инженерный
  объект и его центральные представления; поддержка/чат остаются отдельным view.
- [Settings](https://learn.chatgpt.com/docs/reference/settings?surface=app):
  отдельные sections настроек и Appearance с light/dark/system и theme customization.
  В Saturn реализованы язык, три режима темы, акцент, иконка Home и presets;
  пользовательские шрифты/импорт произвольной темы пока не заявляются.
- [Plugins](https://learn.chatgpt.com/docs/plugins?surface=app): отдельное место
  поиска и просмотра reusable capabilities. В Saturn UI адаптирован к project-owned
  source kits и существующим imports; глобальный lifecycle OpenAI не переносится.
- [Scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app): общий
  список состояний задач и результатов запусков. В Saturn предложена центральная
  страница отчётов/программ/deploy с runtime ownership; эти серверные задачи
  не зависят от открытого browser tab или AI chat prompt.
- [Code review](https://learn.chatgpt.com/docs/code-review?surface=app): scopes
  Unstaged/Staged/Branch/Last turn и review pane. Git diff в Saturn отделён от
  checked/published/applied и физических изменений на объекте.
- [Work with files](https://learn.chatgpt.com/docs/artifacts-viewer): просмотр
  результата рядом с разговором. В Saturn split drawer относится к странице чата,
  в других разделах инженерный результат занимает центр shell.

### Корзина, каталог рядом с редактором и мобильный shell — 2026-09-30

Блок версии/выпусков убран из explorer; IDEUpdates остаётся в Settings → About.
Внизу explorer находится только неброская SVG-кнопка корзины с доступным названием
и tooltip. Каталог не занимает постоянную строку навигации: в TS/2D/3D он открывается
иконкой в toolbar в правом слоте Shell, рядом с исходником или визуализацией.
Каталог использует существующий ResourceCatalog для оборудования проекта и API
scaffold для базовых и project-owned шаблонов. Создание сохраняет явный импорт
в project.ts после предпросмотра. В 2D/3D остаётся тот же редактор и dimension;
в TS открывается новый исходник, предыдущий draft сохраняется. Начальная позиция
вычисляется из authored diagram bounds и настоящих трасс связей: справа от их
границ с отступом. Preview возвращает координаты, apply использует именно их;
исходное оборудование не перемещается. После добавления в 2D/3D камера вписывает
новый состав. Пользователь может изменить позицию обычным drag/source editing. Файлы исходных
наборов оборудования по-прежнему принадлежат проекту, не глобальной установке.
`?page=equipment` — отдельный просмотр всего каталога; `details=catalog` — та же
Shell-панель рядом с другим view. Корзина имеет `?page=trash`.

WorkspaceTrash владеет удалёнными файлами в `<project>/.saturn/trash/<uuid>/`.
Метаданные записываются до rename исходного файла; незавершённая запись без content
не считается удалением. Версия исходника проверяется перед перемещением; Shell
сначала запрещает удаление dirty/saving buffer. Восстановление использует exclusive
create, проверяет hash, безопасные пути/parents и сохраняет байты/права оригинала.
Оно не заменяет уже существующий файл. Backup удаляется только после успешного
восстановления. Это file trash: удаления из Project arrays, исправление imports и
обратное изменение физического оборудования не подразумеваются.

Срок хранения — 30 × 24 часа от deletedAt, вне зависимости от часового пояса UI.
Host очищает просроченные копии на старте, раз в час и при чтении корзины; восстановить
просроченную копию нельзя. При выключенном host очистка догоняет срок при следующем
запуске. Это не удалённый scheduler и не обещание выполнения на выключенном ноутбуке.
Trash не попадает в authored resource index/build; runtime не импортирует workspace
и не владеет этим хранилищем. Изменение исходников запускает обычный check, сохраняя
различия source/checked/published/applied и существующее правило simulator-only preview.

При ширине до 760 px, а также на touch-устройствах до 1024 px (включая
ландшафтную ориентацию телефона), используется отдельный мобильный chrome: header с историей,
именем проекта/страницы, runtime status и проводником; четыре нижних touch перехода;
modal sheet главного меню. Desktop rail/header/tab strip скрыты. Центральный view
использует полную ширину; project/settings/thread explorer открывается на всё тело
экрана. Catalog и inspector являются отдельными Shell-панелями; на телефоне временно
занимают тело экрана, с доступной кнопкой возврата. Footer/navigation учитывают safe
area; кнопки основных переходов и toolbar имеют touch targets от 44 px. Native dialog
управляет focus/Escape/backdrop. Тема, язык, preset, документы, URLs и права исполнения
сохранены в существующих owners; отдельная мобильная модель Project не введена.
Домашний preset ведёт вторым нижним переходом в HMI, бизнесовый — в performance.
Поддержка/чат остаются в конце полного меню, не основной стартовой страницей.


## Общая навигация и компоновка Shell — 30 сентября 2026

Headless `shell/model/navigation-catalog.ts` задаёт метаданные существующих
EditorId и UI visibility для rail, мобильного меню, New tab, поиска и быстрых
переходов. Наличие renderer централизовано в core `supportsEditor`; labels
контекстного действия «Показать в коде» не создают второй source view.
Каталог не исполняет команды объекта и не является installation registry.

Headless `shell/model/layout.ts` владеет только страницей и слотами Shell:
tool/launcher, central/closed/split/full, единственной областью properties/review/catalog
и сводкой. ShellSession по-прежнему владеет ресурсами/вкладками и Documents;
нижняя панель использует существующий panel reducer. BrowserView adapter
сохраняет текущие deep links, включая camera/viewBox и выбранный ресурс.
Кнопки деталей находятся в chrome; содержимое деталей — в отдельном слоте
Shell, не внутри конкретного view. Из view удалены общий список «Перейти» и
дублирующее chrome; их capabilities доступны через общую навигацию и меню.

Полное разложение на системные плагины, fork/PR и объединение режимов пока
не выполнены; план и статус первого этапа — в `shell-extension-design.md`.

## MCP Apps adapter

`src/host/apps.ts` composes an HTTP MCP transport with the existing workspace host's
`ShellClient`; it does not transfer workspace/runtime ownership to the model. The
browser uses `AppsClient` as a transport for the same Shell and project browser entry.
An immutable MCP HTML resource uses a temporary URL-navigation adapter, including
Back/Forward, and shares the ordinary standalone URL with its host. This is view
state, not another authoring format. Runtime/project data and credentials are not
stored in a plugin manifest.

Read/check/source-write tools and explicit publish/apply/control tools remain
separate, preserving workspace versions and runtime identity fences. App-only
updates carry full UI state through `_meta` and coalesce telemetry; the model gets
compact project summaries and current view context. The UI bundle and resource URI
are content-versioned. Source/model hot reload preserves the render instance and
unchanged device resources. Browser-code changes require a rebuilt resource.

The chosen local deployment binds to loopback and uses the official Secure MCP
Tunnel for transport. It is a trusted local workspace adapter, not completed
per-user OAuth/audit or independent dev-runtime isolation. Native ChatGPT account
connection and public directory publication remain separate acceptance steps.
See [the Apps runbook](chatgpt-apps.md).
