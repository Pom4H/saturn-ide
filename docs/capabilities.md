# Матрица сохранения возможностей

Это обязательства переноса, а не каталог будущих пожеланий. Старый код указан по ревизии
Pom4H/saturn `90da21a1885a72022b7a2d1b45cb36993bee1597`. Наличие реализации в старом репозитории
не подменяет проверку её поведения на новом host. Статус «частично» блокирует заявление о parity.

| Возможность / старый источник | Владелец в новой структуре | Сейчас | Проверка завершения |
| --- | --- | --- | --- |
| Источник на TS; compileProject (`plant/compiler.ts`) | workspace/build | Bun build вынесен из runtime | Обычные imports, ошибки с диапазонами, проект вне каталога IDE; broken draft не меняет applied |
| Конкретные сигналы/outputs (`plant/dsl.ts`) | core | Сохранены ID, value types, writability и project inference | Новый тип агрегата добавляется без редактирования core; имена/типы выходов выводятся |
| Вычисляемые выражения и размерности (`plant/dsl.ts`, `plant/types.ts`) | core + runtime | **Не перенесено полностью** | Отвергать несовместимые размерности; вычисление и качество derived-сигналов; ошибки RU/EN |
| Копируемые расширения (ADR-0008, ModelCatalog) | project/equipment, project/plugins | Драйверы — да, оборудование — **частично** | Скопировать второй тип оборудования, его виды/тесты и target без изменения приложения |
| Физические порты/топология (`plant/ports.ts`, `plant/routing.ts`) | core/topology + equipment | Трубы/кабели и XYZ routing есть, не все extension-defined профили перенесены | Совместимость среды/семейства/направления; ветвления, занятость, bus reachability; все старые сценарии |
| Исходные SVG (`src/equipment-svg.ts`) | shell/scene, equipment views | Текущий renderer сохранён побайтно при перемещении | Реальные эталонные кадры и состояния good/stale/stopped; согласование человеком |
| 3D (`src/elements/models3d.ts`, `plant/visual3d.ts`) | shell/scene3d, equipment views | Новый renderer есть; **визуальная parity не подтверждена** | Тот же граф/порты, телеметрия без rebuild, фаза без скачков, GPU lifecycle и реальные видеозаписи |
| Two-way editing | workspace/files + source-edits + shell/editor/scene | Сохранена реализация | Drag до drop, cancel/undo одним жестом, форматирование, computed positions, конфликт внешнего изменения |
| Единое Presentation/HMI (ADR-0008, plant/presentation) | core presentation + target renderer | Браузерный SVG HMI; **canonical Presentation и физический target не завершены** | Один authored экран → web/operator и реальный целевой дисплей; никаких отдельных HMI-сигналов |
| История/воспроизведение (`plant/service.ts`, kernel/store) | runtime | История есть, **replay/checkpoint parity нет** | Restart, source/build/run provenance; воспроизведение изолировано от live commands |
| Отчёты (`plant/reporting.ts`, dsl, Service.runJobs) | core report plan + runtime jobs + shell reports | Агрегации/CSV/печать есть; **jobs, XLSX, typed schemas частично/не перенесены** | Почасовой расход, пропуски, часовые пояса, типы сортировок/колонок, повторный запуск задания без дубля |
| Immutable BuildArtifact (`plant/artifact.ts`) | core/artifact + workspace/build | Новый v2 hash/driver/provenance/verify | Transport round trip, tamper, проверенная миграция v1 без потери сущностей; source ≠ build |
| Управляемое apply (`plant/service.ts`, store) | runtime/installation + revisions | В dev подключены CAS/restore/fencing и rollback автомата | Bun+SQLite+Postgres fault tests, реальный драйвер, outage/restart; не выдавать physical rollback за конфигурационный |
| Независимый runtime и роли (`plant/http-server.ts`, Service) | runtime-only host + transport auth | **Частично**: отдельный runtime-only host, CAS и process-isolation test; SaaS capabilities/gateway; dev остаётся одним процессом, per-user audit ещё нет | IDE crash/CPU loop не прекращают DAQ; отдельные права author/publish/control; никаких source API в kiosk |
| Shell Project/Surface/Environment | shell | Перенесён текущий Shell, большой App **ещё требует разделения состояния** | От оборудования к сигналу/коду/истории/отчёту; retained drafts; видимые source/checked/published/applied |
| Controller target | project/equipment/<controller>, targets | Контракт compiler/emulator есть; конкретный toolchain и аппаратная приёмка принадлежат project-owned extension | Сборка реальной прошивки, проверка памяти/портов/экрана, эмулятор и аппаратный тест |
| Browser/offline, standalone, VS Code (старые host/docs) | отдельные host adapters над теми же модулями | **Не перенесены** | Открытие того же проекта, offline ограничения, runtime-only/kiosk, отсутствие второго DSL |

## Как планировать новую функцию

Сначала найти её владельца и проверить, нет ли уже реализации в старом Saturn. В задаче указать
источник, сохраняемый контракт, инженерный и операторский сценарии, формат данных/версий и тест.
Нельзя закрыть строку словами «упростили MVP». Удаление полезной возможности требует отдельного
решения пользователя. Нельзя заводить ещё один Project/Signal/Topology ради нового host.

Порядок завершения основы: runtime isolation и live/draft UX → project-owned equipment и единые
определения сигналов/размерностей → общий Presentation/targets → отчёты/jobs/replay → остальные hosts.
Визуальные и two-way regression tests сопровождают каждый этап, а не откладываются на конец.
