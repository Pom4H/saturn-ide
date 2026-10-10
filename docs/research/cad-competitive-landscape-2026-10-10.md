# CAD следующего поколения: конкурентная карта и инженерные ориентиры для Saturn IDE

Дата среза: **2026-10-10**. Назначение: контекст для принятия архитектурных и UX-решений, **не спецификация готовой CAD-функции**. Область: mechanical/code-first CAD, geometry kernels, ECAD, BIM/plant, цифровые двойники и industrial engineering IDE. «Все конкуренты» здесь означает **основные проверенные классы и репрезентативные продукты**, не исчерпывающий мировой реестр.

## 0. Как проверяли

- **[CODE]** — прочитан конкретный файл GitHub, ссылка в тексте. Подтверждает только прочитанный участок, не end-to-end работоспособность.
- **[README]** — заявление авторов проекта в README/документации. Не является независимым performance/UX-тестом.
- **[VENDOR]** — официальное описание коммерческого продукта; исходный код не аудирован.
- **[SATURN]** — проверен текущий исходник/контракт нашего репозитория. Тесты заново в этом исследовании **не запускались**.
- Отмечаем active/archived и лицензию **как сигналы GitHub на дату среза**; лицензия у конкретных зависимостей/ассетов требует отдельной проверки перед включением. Ни звёзды, ни описание «AI-native» не доказывают качество.

Главные вопросы сравнения: authored source; независимые проекции; GUI↔source; constraints и размеры; топологическая идентичность после изменений; форматы STEP/IFC; simulation/runtime; Git/collaboration; agent API; local/offline; licensing; evidence/CI.

## 1. Краткий вывод

Saturn конкурирует **не** с механическим CAD по скорости создания сложного корпуса. Его потенциальная категория — **engineering system as code от проекта физического объекта до его эксплуатации**: equipment/ports/topology → CAD/BIM reference → signals/PLC/HMI → historian/reports → controlled deployment.

Лучшие идеи для заимствования:
1. **Zoo**: CAD как текстовый authored source; визуальные жесты изменяют AST; artifact↔source mapping; constraints в том же языке.
2. **Onshape/Shapr3D**: selection-first UX, history, версии/ветки, видимый и обратимый результат операций, восстановление ссылок.
3. **tscircuit/atopile**: типизированные инженерные связи, units, checks, промежуточные модели и вывод разных артефактов.
4. **Speckle/Autodesk Tandem**: BIM/объект и эксплуатационные данные в общем навигационном контексте, provenance внешних моделей.
5. **vcad/replicad/Truck**: готовые геометрические ядра и headless/agent APIs; при этом **не переносить выбор kernel в ядро Saturn**.

**Рекомендация**: сначала безопасный BIM/IFC exchange и семантические CAD-параметры для оборудования, затем ограниченный параметрический CAD-плагин. Не писать собственный B-Rep и не создавать второй authored Project.

## 2. Карта конкурентов и смежных технологий

| Уровень | Продукт / первичный источник | Что изучать | Тип evidence / отношение к Saturn |
| --- | --- | --- | --- |
| Code+GUI CAD | [Zoo Design Studio / KittyCAD](https://github.com/KittyCAD/modeling-app) | KCL, AST edits, artifact graph, 2D sketch constraints, агент | [CODE] прямой UX/authoring reference |
| Code+GUI CAD | [Tau](https://github.com/taucad/tau) | multi-kernel plugin host, Monaco, AI, тестовый harness | [CODE+README] architectural comparison, ранняя стадия |
| Rust CAD+agent | [vcad](https://github.com/ecto/vcad) | Rust B-Rep/WASM, assemblies, MCP, physics gym | [README+CODE] возможный adapter, оценить зрелость |
| Browser CAD | [OpenZCAD](https://github.com/esaueng/OpenZCAD) | exact geometry, direct edit, topological lineage и fail-closed identity | [CODE] архитектурный риск-ориентир; молодой проект |
| Parametric GUI | [Dune 3D](https://github.com/dune3d/dune3d) | 3D constraint solving, command palette, OCCT, SolveSpace solver | [README] UX/solver reference, GPL-3.0 |
| Parametric GUI | [SolveSpace](https://github.com/solvespace/solvespace) | constraints, степени свободы, equations | [README] solver reference, GPL-3.0 |
| Browser parametric | [JSKetcher](https://github.com/xibyte/jsketcher) | browser 2D/3D, инструментальная модель редактора | [README] UI reference |
| Mature mechanical | [FreeCAD](https://github.com/FreeCAD/FreeCAD) | workbenches, параметрическое дерево, CAD interop | [README] capabilities ceiling, не копировать полный объём |
| Script CAD | [replicad](https://github.com/sgenoud/replicad) | TS API над OpenCascade WASM; встроить в web | [README] кандидат узкого проектного плагина |
| Script CAD | [build123d](https://github.com/gumyr/build123d) | выразительная algebraic Python B-Rep | [README] язык/типизированная геометрия |
| Script CAD | [CadQuery](https://github.com/CadQuery/cadquery) | Python CAD scripting/OCCT; selectors | [README] script-style engineering |
| Script CAD | [OpenJSCAD](https://github.com/jscad/OpenJSCAD.org) | JS+CLI parametric CSG | [README] low-dependency geometry, не точный STEP workflow |
| Geometry kernel | [OpenCascade.js](https://github.com/donalffons/opencascade.js) | OCCT в WASM, API/память/сборка | [README] adapter candidate; repo давно не пушился |
| Geometry kernel | [Truck](https://github.com/ricosjp/truck) | modular Rust NURBS/B-Rep, tessellation, WebGPU tools | [README] исследовательский kernel |
| Geometry kernel | [Manifold](https://github.com/elalish/manifold) | robust solid mesh booleans и JS bindings | [README] **mesh**, не подменяет exact B-Rep |
| Constraint solver | [EZPZ](https://github.com/KittyCAD/ezpz) | Rust solver с CLI/WASM и benchmarks | [README] кандидат для отдельных constraints |
| Constraint solver | [SolveSpace exposed](https://github.com/solvespace/solvespace/blob/master/exposed/DOC.txt) | параметры/ограничения, доступность API | [README] проверить лицензионную границу |
| ECAD-as-code | [tscircuit](https://github.com/tscircuit/tscircuit) | React/TS, схема↔PCB↔production, exports | [CODE+README] сильнейший доменный reference |
| ECAD IR | [Circuit JSON](https://github.com/tscircuit/circuit-json) | typed IR, Gerber/BOM/SPICE/SVG и converters | [README] projections from one checked IR |
| ECAD-as-code | [atopile](https://github.com/atopile/atopile) | declarative modules, units, tolerances, equations, KiCad | [README] semantic constraints и build |
| ECAD GUI | [KiCad](https://github.com/KiCad/kicad-source-mirror) | ERC/DRC, символы/посадочные места, фабрикация | [README] fidelity benchmark; GitHub — зеркало |
| BIM exchange | [IfcOpenShell / Bonsai](https://github.com/IfcOpenShell/IfcOpenShell) | IFC2x3/4/4.3, semantic ports, IfcConvert | [README] начало CAD-1, лицензии модулей различаются |
| BIM collaboration | [Speckle](https://github.com/specklesystems/speckle-server) | object versioning/commits/connectors/web viewer | [README] model exchange, не operational source |
| Operator SCADA | [FUXA](https://github.com/frangoteam/FUXA) | web HMI, драйверы, live tags, редактор | [CODE+README] open-source операторский конкурент |
| Operator SCADA | [SCADA-LTS](https://github.com/SCADA-LTS/Scada-LTS) | historian, alarms, протоколы | [README] SCADA baseline |
| Flow tooling | [Node-RED](https://github.com/node-red/node-red) | visual flow/runtime, экосистема устройств | [README] инженерный UX reference, не CAD |
| Commercial cloud CAD | [Onshape](https://cad.onshape.com/help/Content/Document/versions_and_history.htm) | branches/merge/versions, FeatureScript | [VENDOR] UX/reference state history |
| Commercial hybrid CAD | [Shapr3D](https://support.shapr3d.com/hc/en-us/articles/14030415438748-Direct-vs-Parametric) | direct+history, adaptive selection-first UI | [VENDOR] основной UX reference |
| Commercial integrated | [Autodesk Fusion](https://help.autodesk.com/view/fusion360/ENU/) | CAD/CAM/CAE/PCB в платформе | [VENDOR] full-lifecycle breadth, не цель MVP |
| Commercial BIM+ops | [Autodesk Tandem](https://www.autodesk.com/products/tandem/overview) | BIM assets + telemetry/history/system tracing | [VENDOR] прямой digital-twin конкурент |
| Commercial plant | [Autodesk Plant 3D](https://www.autodesk.com/products/autocad/included-toolsets/autocad-plant-3d) | технологическая 3D-топология/P&ID | [VENDOR] CAD interoperability |
| Commercial plant | [Bentley OpenPlant](https://www.bentley.com/software/openplant/) | pipes/equipment/project geometry | [VENDOR] plant reference, не сопоставлять по цене без теста |
| Commercial BIM MEP | [Autodesk Revit](https://www.autodesk.com/products/revit/overview), [nanoCAD BIM](https://www.nanocad.ru/products/bim/) | MEP connectors, системы, этажи, лотки | [VENDOR] импортная область CAD-1 |
| Industrial IDE | [Ignition 8.3](https://docs.inductiveautomation.com/docs/8.3/platform/designer) | designer/gateway/tags/history/reports/Perspective | [VENDOR] прямой SCADA engineering соперник |
| Industrial IDE | [CODESYS](https://www.codesys.com/products/visualization/) | PLC IEC 61131-3 + visualization, OPC UA | [VENDOR] PLC+HMI reference |
| Industrial IDE | [TwinCAT 3](https://www.beckhoff.com/en-en/products/automation/twincat/) | IDE PLC/program + target runtime | [VENDOR] target/engineering reference |

Отдельно: [Fornjot](https://github.com/hannobraun/fornjot) (архивирован 2026-06), [CADmium](https://github.com/CADmium-Co/CADmium) (архивирован 2025-09): полезны как исторические исследования, но **не** брать базой поддерживаемой интеграции.

## 3. Важные реализации, глубже README

### Zoo: artifact → semantic code reference → проверенная правка

- [CODE: `src/lang/std/artifactGraph.ts`](https://github.com/KittyCAD/modeling-app/blob/main/src/lang/std/artifactGraph.ts) — связывает результаты исполнения CAD с артефактами.
- [CODE: `src/lang/modifyAst/deleteSelection.ts`](https://github.com/KittyCAD/modeling-app/blob/main/src/lang/modifyAst/deleteSelection.ts) — selection разрешается в CodeRef; удаление sketch/constraint отдаёт SourceDelta/SceneGraphDelta, другие операции правят AST, проверяют зависимости и mock-execution. При неразрешимых ссылках удаление отклоняется.
- [CODE: `src/lang/sourceRange.ts`](https://github.com/KittyCAD/modeling-app/blob/main/src/lang/sourceRange.ts) — source-range boundary.
- [VENDOR: KCL 3.0, 2026-10-08](https://docs.zoo.dev/blog/kcl-3) — новое поколение языка/формата, совместимость старых проектов сохранена по заявлению Zoo.
- [VENDOR: constraint sketch, 2026-05-28](https://zoo.dev/blog/announcing-solver) — инженер рисует приблизительную форму, затем фиксирует размеры/отношения и степени свободы; та же задача выражается в KCL sketch blocks.

**Заимствовать контракт**, а не чужую модель: shape/equipment selection → stable semantic resource ID → source locator → proposed edit → validation → commit/undo. Не пытаться реконструировать arbitrary TS из геометрии. Клиент/планшет не должен нуждаться в удалённом видеопотоке для обычного редактирования труб.

### Tau: несколько ядер полезны как plugins, опасны как доменная модель

- [CODE: `packages/plugins/zoo/src/zoo.kernel.ts`](https://github.com/taucad/tau/blob/main/packages/plugins/zoo/src/zoo.kernel.ts), [CODE: `apps/runtime-e2e/.../models.mts`](https://github.com/taucad/tau/blob/main/apps/runtime-e2e/src/compute-baseline/harness/models.mts).
- [README](https://github.com/taucad/tau): декларирует replicad, Manifold, KCL, JSCAD, build123d, tscircuit и другие adapters; не значит, что у каждого одинаковый feature/API/export fidelity.

**Урок**: общий интерфейс результатов вроде CAD asset + bounds + units + feature references + diagnostics возможен; общий суперкласс всех CAD kernels не нужен в Saturn core. Отсутствующие возможности надо показывать, не маскировать.

### vcad: Rust/WASM + headless + агент, но эксплуатация отдельна

- [README](https://github.com/ecto/vcad): own B-Rep crates, STEP/STL/GLB, constraints, assemblies, React UI, Rust CLI.
- [CODE/DOC: MCP](https://github.com/ecto/vcad/blob/main/packages/mcp/README.md): packs для DFM, sheet metal, physics, ECAD; ограничение набора tool schemas в сессии; document ID в вызовах; симуляция как `gym_step`/`gym_reset`.
- Наличие physics tool **не** доказывает пригодность для цифрового двойника насосной или realtime PLC. Не сливать gym state и измеренную телеметрию.

**Урок**: agent инструменты должны быть доменно-направленными, маленькими и проверяемыми. В Saturn это MCP/ACP над существующими workspace/runtime APIs, без собственного второго agent runtime.

### OpenZCAD: проблема топологической идентичности не решается ID меша

- [CODE: ADR-013 persistent topology lineage](https://github.com/esaueng/OpenZCAD/blob/main/docs/adrs/ADR-013-persistent-topology-lineage.md) фиксирует строгие правила сохранения ссылок на грани/рёбра, проверку геометрических свидетелей и **fail-closed** при неоднозначности.
- [README](https://github.com/esaueng/OpenZCAD): exact B-Rep/WASM, feature history, edits на модели, local-first. На дату среза очень молодой проект.

**Урок**: ссылку на CAD face нельзя приравнивать к индексу треугольника или позиций в массиве. Грань после fillet/boolean может исчезнуть, разделиться или измениться. В Saturn ссылка на физический порт оборудования и ссылка на face CAD — **разные идентичности**.

### tscircuit: IR не обязан быть восстановимым авторским кодом

- [CODE: `@tscircuit/core`](https://github.com/tscircuit/core/blob/main/README.md): JSX или объектное API → `CircuitJson`.
- [README: Circuit JSON](https://github.com/tscircuit/circuit-json): общий низкоуровневый IR для schematic, PCB, Gerber, BOM, SPICE, viewer.
- [README: reverse converter](https://github.com/tscircuit/circuit-json-to-tscircuit): авторы **прямо оговаривают**, что полноценный TS-исходник нельзя в общем случае восстановить из Circuit JSON.

**Урок**: Saturn BuildArtifact / derived semantic graph — не editable «первоисточник». Изменения из визуального вида должны адресовать authored source или требовать явного редактируемого адаптера. Не обещать двусторонность для любой импортированной BIM/CAD-сущности.

### atopile, Dune 3D, Shapr3D: инженерное намерение важнее координат

- [atopile README](https://github.com/atopile/atopile): модульность, unit/tolerance/assertion, constraint-based подбор электронных компонентов, KiCad export.
- [Dune 3D README](https://github.com/dune3d/dune3d): OCCT и SolveSpace constraint solver; критика 2D-only sketch и хрупких downstream references в параметрических редакторах.
- [Shapr3D official](https://www.shapr3d.com/content-library/shapr3d-history-based-parametric-modeling): прямое изменение граней и edit history живут в одном UX; инструменты появляются в контексте selection.

**Урок**: пользователю удобнее задать «соосно фланцу / фиксированный зазор / это кабельный ввод», а не вручную синхронизировать десятки XYZ. Но надо явно показывать under-/over-constrained состояние и возможность редактировать истинный driving параметр.

### Speckle, Tandem, Ignition: эксплуатационный контекст

- [Speckle GitHub](https://github.com/specklesystems): interoperable BIM structured objects, versioning/connectors/web viewer. Это прежде всего движение проектных данных между CAD/BIM системами, не PLC authority.
- [Autodesk Tandem product](https://www.autodesk.com/products/tandem/overview): BIM-пространство + streams/historical data, поиск систем и assets. **Близок к Saturn по ценности инженерной навигации при эксплуатации**, но не заменяет локальный инженерный source/firmware build.
- [Ignition 8.3 docs](https://docs.inductiveautomation.com/docs/8.3/platform/tags): Tags связывают Gateway, HMI, alarms, historian; [Designer](https://docs.inductiveautomation.com/docs/8.3/platform/designer) собирает интерфейс, history и reports. Это полноценный SCADA-продукт, а не «куча тегов без модели».

**Урок**: Saturn должен доказать одну согласованную инженерную работу от PLC порта до операторского предупреждения/отчёта с ревизией. Нельзя продавать просто «единый источник сигналов»: зрелые конкуренты уже дают части этой ценности.

## 4. Границы текущего Saturn (проверено по исходникам, без запуска тестов)

- [SATURN: architecture](../architecture.md) и [capabilities](../capabilities.md): authored TypeScript ≠ checked BuildArtifact ≠ published ≠ applied. **Никаких** скрытых вторых моделей Project/Signal/Topology.
- [SATURN: `src/core/cad.ts`](../../src/core/cad.ts): `CadReference` — read-only IFC external reference; storeys/spaces/runs/ports/connections; units в метрах, явный origin и `displayScale` для schematic projection. `CadRunPlan` порождает геометрию **проекции**, не новый физический Pipe.
- [SATURN: `docs/importers.md`](../importers.md): `ifc-spatial` живёт в `Pom4H/saturn-plugins`; повторный импорт по Project GlobalId с файлами/manifest и CAS. Импорт не вызывает publish/apply.
- [SATURN: `docs/spatial-routing.md`](../spatial-routing.md): `system.z` + XYZ `via` и символические `room.ports` уже существуют. X/Y — **единицы схемы**, а не метры/мм; это не B-Rep, не BIM стены и не проверка монтажной коллизии.
- [SATURN: `ROADMAP.md#CAD-1`](../../ROADMAP.md#cad-1--импорт-cadbim-как-пространственной-подложки-и-маршрутов): IFC import vs native connector, provenance, raceways, reimport. Эти критерии остаются открытыми несмотря на первый синтетический IFC инкремент.

Продуктовая граница:
`physical topology/ports/signals` — authored Saturn domain;
`CAD solids/faces/sketches and external BIM placements` — geometry assets or references, with provenance;
`simulation` — verified model with separate assumptions;
`runtime telemetry/commands` — applied authority, never synthesized from CAD geometry.

## 5. Матрица решений: что брать и что не брать

| Паттерн | Решение для Saturn | Почему |
| --- | --- | --- |
| Клик по объекту → его исходник | **Adopt** | Тот же semantic graph, resource ID и source locator; не второй authored storage |
| Прямое перемещение оборудования/трубы | **Adopt/strengthen** | Preview и drag transaction, валидировать source edits, single undo, no implicit apply |
| Параметрические constraints (mount, align, clearance) | **Experiment** | Сначала для одного enclosure/панели и портов; измерить устойчивость |
| Локальный WASM exact B-Rep | **Experiment as optional plugin** | Не нужен для всех SCADA-проектов; runtime должен работать без CAD library |
| Geometry kernel chooser для каждого проекта | **Not core** | Несовпадающие capabilities/units/topology, рост поддержки |
| Собственный B-Rep на Rust | **Defer** | Сначала сравнить replicad/OCCT и Truck/vcad на одинаковых fixtures |
| CAD mesh = реальная сеть кабелей/труб | **Reject** | Графическая близость не доказывает connection/provenance |
| CAD geometry как источник сигналов | **Reject** | Сигнал привязан к инженерному ресурсу/драйверу, не к мешу |
| Автоматический reverse-compile произвольного TS | **Reject** | Общий IR не сохраняет авторский синтаксис/намерение |
| Свободный AI apply на live plant | **Reject** | Agent proposes source change → check/review/Git/publish/apply под authority |
| Live CAD→SCADA auto publish | **Reject** | Строительный проект/физическое оборудование и applied runtime разделены |
| Выставить коммерческое «performance parity» без своих тестов | **Reject** | Только повторяемые fixtures и измерения локального CI |

## 6. Минимальная архитектура следующего эксперимента

`Authored TypeScript → Checked engineering IR` и два **независимых** слоя:
- `SpatialReference`: importer/external doc hash, external stable ID, length/angle units, coordinate frame, entity type, optional geometry cache. **Не** редактируемая установка.
- `ParametricGeometry`: проектный плагин создаёт `part + feature/parameter refs + diagnostics`; edits идут назад к точному authored source locator через workspace CAS; STEP export делается только при поддержанном геометрическом ядре.

Связь: `equipment.id / port.id → mounting/geometry reference`. Не связывать Runtime с B-Rep или React. Нет скрытой новой geometry DB, autorouter не подменяет инженерную сеть.

Если SDK поддерживает только mesh или export STL, он **не проходит** сценарий exact enclosure STEP, но может оставаться просмотрщиком/симуляционным asset tool.

## 7. Приоритетные эксперименты и критерии приёмки (запланированы)

### CAD-R1 — source-linked geometric authoring, P1
Один проект: PLC + насос + монтажная панель с 4 отверстиями и двумя вводами.
- [ ] Параметры в mm (явная размерность), schematic XY по-прежнему независимы; размер в коде и на 3D/2D совпадает.
- [ ] Edit: перетащить hole/порт или изменить размер → точный diff в исходном TS → rebuild; computed/ambiguous source **не** переписывать «наугад».
- [ ] Один gesture = один undo/redo; Escape/reload не оставляют полуправленый source; конфликты CAS показывают review.
- [ ] Поддержанные constraints (fixed distance/coaxial/clearance) проверяются, under-/over-constrained диагностируется.
- [ ] Экспорт STEP после условного replicad/OCCT adapter; STEP import/re-export проверяется независимо инструментом, допуски объявлены.

### CAD-R2 — BIM/IFC safety & provenance, P1 (зависит от CAD-1)
- [ ] Реальная независимая IFC-модель насосной, не только синтетический fixture.
- [ ] Этаж, оси, origin, units, GlobalId сохранены; стену/лоток нельзя принять за сигнал или физическое подключение.
- [ ] Reimport (старый IFC + новый IFC + локальные изменения) показывает трехсторонний diff; удалённый внешний element не удаляет authored PLC/history.
- [ ] Неполные connection/порт/маршрут остаются `unknown/proposed`; нет ложного «подтверждено физически».
- [ ] Неизменность published/applied подтверждена на всех шагах import/reimport.

### CAD-R3 — headless geometry/UX benchmark, P2
Одинаковые 3 fixtures: mounting plate с параметрами и constraints; pipe elbow+flange; большая повторяющаяся сборка. Кандидаты `replicad/OCCT`, `vcad`, `Truck` (там, где функционально доступно); для mesh-only CSG отдельно `Manifold`.
- [ ] Измерить wall time холодной загрузки WASM, пересборки после изменения *одного* размера, memory peak, STEP fidelity/roundtrip, ошибки kernel, repeatability (например 10 запусков на фиксированном hardware).
- [ ] Проверить stable face/port references после fillet, boolean, перемещения hole и перестановки параметрических features; неоднозначность → error, не nearest-face эвристика.
- [ ] Зафиксировать unit/fidelity и поведение cancel/Worker terminate, 2D↔3D selection, видимый preview на CI screenshots/video.
- [ ] Ограничения лицензий каждой конкретной сборки/kernel, bundle size, native/offline requirements.
- [ ] Профиль производительности и результат CI (не сравнивать заявленные FPS с рендером другого engine).

**Принятие решения о CAD engine — после экспериментов, не раньше.**

## 8. Чего специально не делать

Не переписывать Shell под CAD; CAD становится контекстом выбранного оборудования/space. Не тащить в Saturn core feature tree, если для выбранного объекта нужен только imported STEP. Не представлять glTF mesh как machining-grade solid. Не пытаться одновременно сделать PLM, CAM, BIM editor, EDA и PLC firmware из одного нового большого UI. Не смешивать схемные 2D/3D-пространственные координаты с CAD метрическими размерами. Не приближать геометрию «на глаз», когда требуется миллиметровый контракт.

## 9. Статус исследования и следующие источники

**Проверено**: публичные repository metadata/README и отдельные исходные файлы Zoo, Tau, vcad, OpenZCAD, tscircuit; текущие исходники Saturn CAD/importer/architecture; официальные продуктовые страницы Onshape, Shapr3D, Zoo, Autodesk Tandem, Fusion, Ignition.

**Не проверено**: независимый hands-on UX с реальными файлами во всех коммерческих CAD; runtime/benchmarks конкурентов; цены/доступность/гарантии; промышленная STEP/BIM interoperability на реальных объектах; лицензирование бинарных kernel сборок; полноценная source/feature parity; сравнение под одним CI профилем.

Полезные ссылки для последующего исследования:
- [Zoo KCL 3](https://docs.zoo.dev/blog/kcl-3), [EZPZ](https://github.com/KittyCAD/ezpz), [Zoo AST source delta](https://github.com/KittyCAD/modeling-app/blob/main/src/lang/modifyAst/deleteSelection.ts)
- [Onshape merge constraints](https://cad.onshape.com/help/Content/Document/merging.htm), [Onshape FeatureScript](https://cad.onshape.com/help/Content/FeatureStudio/feature_studios.htm), [Shapr3D adaptive UI](https://support.shapr3d.com/hc/en-us/articles/7873882619548-Adaptive-user-interface)
- [OpenZCAD persistent topology](https://github.com/esaueng/OpenZCAD/blob/main/docs/adrs/ADR-013-persistent-topology-lineage.md), [tscircuit reverse IR limitation](https://github.com/tscircuit/circuit-json-to-tscircuit)
- [IFC samples](https://github.com/buildingSMART/IFC4.x-specification-models), [IfcOpenShell](https://github.com/IfcOpenShell/IfcOpenShell), [Speckle](https://github.com/specklesystems/speckle-server)
