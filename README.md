# Saturn IDE

Инженерная IDE вокруг одного TypeScript-проекта физического объекта. Без лендинга.

```sh
bun install
bun dev
```

Браузер: `http://localhost:3000`. SQLite создаётся автоматически; PostgreSQL выбирается через
`DATABASE_URL`. Git устанавливается отдельно. Тому же серверу доступен терминальный Shell:

```sh
# В другом терминале, пока bun dev работает:
bun tui
# Или подключение к конкретному workspace:
bun tui http://127.0.0.1:3001
# Без интерактивного TTY — обычный список объектов:
bun shell:list
```

`bun tui` — React/OpenTUI, а не браузер внутри терминала. Поиск объектов, исходники и сохранение,
текстовые связи/сигналы, результат SQL-отчёта и Git status/diff используют ту же модель Shell и
тот же сервер. F2 — исходник, F3 — топология, F4 — сигналы, F5 — отчёт, F6 — Git, F8 — RU/EN,
Ctrl+K — поиск, Ctrl+S — сохранить, Ctrl+Q — выход. Закрытие подключённого TUI не останавливает сервер.
Полного равенства графических и терминальных возможностей нет: SVG/3D/HMI остаются графическими
представлениями; управление оборудованием, IntelliSense и release-операции TUI ещё не завершены.

## Устройство как файл

В дереве, вкладке и поиске отображается **иконка класса + имя экземпляра**. P-01 — один объект,
открываемый как схема, исходник или сигналы, а не три независимых документа. Его исходник —
`project/equipment/P-01.device.ts`; отчёт — `project/reports/hourly-water.report.ts`.
Типовые модули и плагины также открываются как обычные файлы. У сложного ПЛК могут быть дочерние
`hmi.ts`, `compiler.ts`, исходники прошивки. Просмотр каталога не запускает плагины и компиляторы.

Индекс `/api/resources` вычисляется из уже существующей модели и AST рабочих файлов. Он не
является вторым Project, базой плагинов или собственным файловым форматом. Несколько сущностей
в одном старом TS-файле разделяют один буфер. Имя/путь можно менять без изменения идентичности
домена; автоматическое reference-aware переименование/перенос файлов пока не реализовано.

Браузерный Shell и терминальный renderer используют `ShellSession`, `Documents`, общий Fetch/SSE
клиент и один контракт команд. DOM/CSS и TTY-раскладка разделены. Конфликт записи не уничтожает
черновик; ответ сохранения не перезаписывает более свежие нажатия клавиш. Несохранённые буферы
сохраняются при переключении представлений, но пока не восстанавливаются после аварийного выхода.

**Решение и ограничения:** [ADR-0002](docs/adr/0002-resource-oriented-shell.md).
**Исследованные подходы и SVG-техники:** [research](docs/research/isomorphic-shell.md).
**Новые фактически выполненные проверки:** [verification-shell](docs/verification-shell.md).
**Общая архитектура:** [architecture](docs/architecture.md).
**Сохраняемые возможности прежнего Saturn:** [capabilities](docs/capabilities.md).
**Предыдущий проход:** [verification](docs/verification.md).

## Разработка и исполнение

Workspace владеет рабочими файлами, Git, Language Service и сборкой. Runtime — SCADA, SQL,
SSE/push и применённой сборкой. Host соединяет их. Shell владеет навигацией и документами,
не становится ещё одним runtime. Граница shared Shell проверяется `architecture:check`.

Автоматический preview допускается только для доверенного simulator-проекта, когда текущая
установка тоже не live. Для полностью ручного применения:

```sh
SATURN_PREVIEW=manual bun dev
```

`GET /api/releases` возвращает source provenance, checked, published, applied и phase.
`POST /api/publish` принимает `{ hash, expectedPublished }`.
`POST /api/apply` принимает `{ hash, expectedApplied }`.
POST требует JSON и `X-Saturn-Key` из `/api/state` или `/api/releases`.
Live-команды требуют `expectedApplied`, live-сборки — записанный lockfile.
В Shell отображаются checked/published/applied; полноценный release workflow и отдельный
checked-draft preview для live-среды ещё не завершены. Открытие файла не является apply.

Применённые сборки сохраняются в SQL и восстанавливаются до чтения рабочего проекта.
`saturn.build@2` включает модель, bundled driver, хеши исходников/ядра/lockfile и версию builder.
Это доверенный исполняемый код, не sandbox и не подписанный пакет.
Dev остаётся одним процессом на loopback. Не считать его публичным SCADA-сервером или доказанной
изоляцией runtime. Runtime-only host, роли, реальные драйверы и аппаратная проверка ещё нужны.

## Графика и расширения

Детальные process SVG и Three-модели не заменяются файловыми иконками. Геометрия оборудования,
топология и 3D renderer сохранены. В 2D вынесен цикл измеренной анимации: кеш SVG-узлов, общая фаза,
пауза скрытой сцены/reduced motion; новые обещания FPS или визуальной parity не делаются.

```sh
bun run scaffold project ../another-station
SATURN_PROJECT=../another-station bun dev
bun run scaffold plc plc-01
bun run scaffold plugin pressure-switch
```

Скопированные файлы подключаются явными imports. Реальный compiler/toolchain задаётся в
`equipment/<device>/compiler.ts`; `bun run firmware equipment/<device>` запускается явно.
Шаблон не создаёт фиктивную прошивку. Произвольное проектное оборудование, размерности/derived,
Presentation, XLSX/jobs/replay и остальные строки capabilities.md не объявлены завершёнными
только потому, что Shell теперь умеет показывать ресурс как файл.

Добавлены проверенные upstream-релизы `@opentui/core`/`@opentui/react` 0.5.12 и `@mdi/js` 7.4.47
(Apache-2.0, только navigation icons). Остальные версии сохранены. Полная установка нового
набора и browser/TTY запуск должны быть проверены; текущие ограничения описаны в verification.

## Проверки

```sh
bun run architecture:check
bun run check
bun test tests
bunx playwright install chromium
bun run test:browser
```

OpenTUI testRender проверяет реальный renderer с тестовым документом. Browser test запускает
настоящий bun dev и сохраняет только реальные кадры. PostgreSQL-тесты включаются через
`TEST_POSTGRES_URL`. Неисполненный тест не считается успешным. Исторический MVP сохранён в
[docs/mvp-before-foundation.md](docs/mvp-before-foundation.md); его заявления не относятся к этому проходу.
